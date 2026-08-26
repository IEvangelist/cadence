import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAuthChange, projectStore } from './appStores'
import { createEmptyProject } from './composer/model/project'
import { serializeProject } from './composer/model/persistence'
import { nextAuthGeneration } from './auth/authContext'

afterEach(async () => {
  await handleAuthChange({
    generation: nextAuthGeneration(),
    mode: 'anonymous',
    ownerId: null,
    purgeOwnerIds: [],
  })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('appStores wiring', () => {
  it('routes saves to localStorage while signed out', async () => {
    await projectStore.save(createEmptyProject('local-1'))
    expect(localStorage.getItem('cadence.v1.project.local-1')).not.toBeNull()
  })

  it('signing in routes saves to the remote API and syncs local-only projects', async () => {
    // One project made while offline.
    await projectStore.save(createEmptyProject('offline-1'))

    const project = createEmptyProject('remote-1')
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.endsWith('/api/auth/csrf')) {
        return new Response(JSON.stringify({ requestToken: 'test-csrf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/api/projects') && method === 'GET') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      // POST create (initial sync + explicit save)
      return new Response(
        JSON.stringify({
          id: 'x',
          name: project.name,
          schemaVersion: 1,
          data: serializeProject(project),
          createdAt: '',
          updatedAt: '2024-01-01T00:00:00Z',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchImpl)

    await handleAuthChange({
      generation: nextAuthGeneration(),
      mode: 'authenticated',
      ownerId: 'test-owner',
      purgeOwnerIds: [],
    })

    // The offline project was pushed up during sign-in sync.
    const postCalls = fetchImpl.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === 'POST')
    expect(postCalls.length).toBeGreaterThanOrEqual(1)

    // Subsequent saves now target the remote store.
    fetchImpl.mockClear()
    await projectStore.save(project)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('retries retained IndexedDB cleanup on startup and owner transitions', async () => {
    const retry = vi.spyOn(projectStore, 'retryPendingCollaborationData')

    await handleAuthChange({
      generation: nextAuthGeneration(),
      mode: 'offline',
      ownerId: 'owner-1',
      purgeOwnerIds: [],
    })
    expect(retry).toHaveBeenLastCalledWith('owner-1')

    await handleAuthChange({
      generation: nextAuthGeneration(),
      mode: 'anonymous',
      ownerId: null,
      purgeOwnerIds: [],
    })
    expect(retry).toHaveBeenLastCalledWith(undefined)
  })
})
