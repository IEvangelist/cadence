import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from './project'
import {
  LocalStorageProjectStore,
  MemoryStorage,
  createProjectStore,
} from './storage'

function makeStore() {
  return new LocalStorageProjectStore(new MemoryStorage())
}

describe('LocalStorageProjectStore', () => {
  it('saves and loads a project', async () => {
    const store = makeStore()
    const project = createEmptyProject('p1')
    project.name = 'Song A'
    if (project.mix) project.mix.master.gainDb = -4
    await store.save(project)
    const loaded = await store.load('p1')
    expect(loaded?.id).toBe('p1')
    expect(loaded?.name).toBe('Song A')
    expect(loaded?.mix?.master.gainDb).toBe(-4)
  })

  it('returns null for a missing project', async () => {
    expect(await makeStore().load('nope')).toBeNull()
  })

  it('returns null when stored data is corrupt', async () => {
    const backend = new MemoryStorage()
    backend.setItem('cadence.v1.project.bad', '{broken')
    const store = new LocalStorageProjectStore(backend)
    expect(await store.load('bad')).toBeNull()
  })

  it('lists projects most-recently-updated first', async () => {
    const store = makeStore()
    await store.save(createEmptyProject('a'))
    await store.save(createEmptyProject('b'))
    // re-saving a bumps its updatedAt to the front
    await store.save(createEmptyProject('a'))
    const list = await store.list()
    expect(list.map((m) => m.id)).toEqual(['a', 'b'])
    expect(list).toHaveLength(2)
  })

  it('deduplicates the index when a project is re-saved', async () => {
    const store = makeStore()
    await store.save(createEmptyProject('a'))
    await store.save(createEmptyProject('a'))
    expect(await store.list()).toHaveLength(1)
  })

  it('removes a project and clears it from the index and last pointer', async () => {
    const store = makeStore()
    const project = createEmptyProject('a')
    await store.save(project)
    await store.setLast('a')
    await store.remove('a')
    expect(await store.load('a')).toBeNull()
    expect(await store.list()).toEqual([])
    expect(await store.loadLast()).toBeNull()
  })

  it('tracks the last opened project for autosave restore', async () => {
    const store = makeStore()
    const project = createEmptyProject('last')
    await store.save(project)
    await store.setLast('last')
    const restored = await store.loadLast()
    expect(restored?.id).toBe('last')
  })

  it('loadLast returns null when nothing was opened', async () => {
    expect(await makeStore().loadLast()).toBeNull()
  })

  it('tolerates a corrupt index', async () => {
    const backend = new MemoryStorage()
    backend.setItem('cadence.v1.index', 'not json')
    const store = new LocalStorageProjectStore(backend)
    expect(await store.list()).toEqual([])
    // saving still works and rebuilds a valid index
    await store.save(createEmptyProject('a'))
    expect(await store.list()).toHaveLength(1)
  })
})

describe('createProjectStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses localStorage in a browser-like environment', async () => {
    const store = createProjectStore()
    const project = createEmptyProject('cs')
    await store.save(project)
    expect(localStorage.getItem('cadence.v1.project.cs')).not.toBeNull()
  })
})
