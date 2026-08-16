import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './project'
import { serializeProject } from './persistence'
import { RemoteProjectStore } from './remoteStore'

const detail = (id: string, name: string, data: string, updatedAt = '2024-01-02T00:00:00Z') => ({
  id,
  name,
  schemaVersion: 1,
  data,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt,
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('RemoteProjectStore', () => {
  it('save() creates via POST', async () => {
    const project = createEmptyProject('p1')
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      return json(detail('p1', project.name, serializeProject(project)), 201)
    })
    const store = new RemoteProjectStore(fetchImpl, '')

    const meta = await store.save(project)

    expect(meta.id).toBe('p1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('save() upserts via PUT when POST reports a conflict', async () => {
    const project = createEmptyProject('p1')
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 409 })
      expect(init?.method).toBe('PUT')
      return json(detail('p1', project.name, serializeProject(project)))
    })
    const store = new RemoteProjectStore(fetchImpl, '')

    const meta = await store.save(project)

    expect(meta.id).toBe('p1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('save() throws on an unexpected error', async () => {
    const store = new RemoteProjectStore(async () => new Response(null, { status: 500 }), '')
    await expect(store.save(createEmptyProject('p1'))).rejects.toThrow(/Failed to save/)
  })

  it('load() returns the parsed project', async () => {
    const project = createEmptyProject('p1')
    if (project.mix) project.mix.master.gainDb = -5
    const store = new RemoteProjectStore(
      async () => json(detail('p1', project.name, serializeProject(project))),
      '',
    )

    const loaded = await store.load('p1')

    expect(loaded?.id).toBe('p1')
    expect(loaded?.mix?.master.gainDb).toBe(-5)
  })

  it('load() returns null on 404', async () => {
    const store = new RemoteProjectStore(async () => new Response(null, { status: 404 }), '')
    expect(await store.load('missing')).toBeNull()
  })

  it('load() returns null when stored data is corrupt', async () => {
    const store = new RemoteProjectStore(async () => json(detail('p1', 'X', 'not-json')), '')
    expect(await store.load('p1')).toBeNull()
  })

  it('list() maps summaries to metadata', async () => {
    const store = new RemoteProjectStore(
      async () =>
        json([
          { id: 'a', name: 'A', schemaVersion: 1, createdAt: '', updatedAt: '2024-01-03T00:00:00Z' },
        ]),
      '',
    )

    const metas = await store.list()

    expect(metas).toHaveLength(1)
    expect(metas[0]).toMatchObject({ id: 'a', name: 'A' })
  })

  it('remove() tolerates a 404', async () => {
    const store = new RemoteProjectStore(async () => new Response(null, { status: 404 }), '')
    await expect(store.remove('missing')).resolves.toBeUndefined()
  })

  it('remove() throws on server error', async () => {
    const store = new RemoteProjectStore(async () => new Response(null, { status: 500 }), '')
    await expect(store.remove('x')).rejects.toThrow(/Failed to delete/)
  })

  it('loadLast() uses the last saved id', async () => {
    const project = createEmptyProject('p1')
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain('/api/projects/p1')
      return json(detail('p1', project.name, serializeProject(project)))
    })
    const store = new RemoteProjectStore(fetchImpl, '')
    await store.setLast('p1')

    const last = await store.loadLast()

    expect(last?.id).toBe('p1')
  })

  it('loadLast() falls back to the newest project', async () => {
    const project = createEmptyProject('newest')
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/api/projects')) {
        return json([
          { id: 'newest', name: 'N', schemaVersion: 1, createdAt: '', updatedAt: '2024-01-05T00:00:00Z' },
        ])
      }
      return json(detail('newest', project.name, serializeProject(project)))
    })
    const store = new RemoteProjectStore(fetchImpl, '')

    const last = await store.loadLast()

    expect(last?.id).toBe('newest')
  })

  it('loadLast() returns null with no projects', async () => {
    const store = new RemoteProjectStore(async () => json([]), '')
    expect(await store.loadLast()).toBeNull()
  })
})
