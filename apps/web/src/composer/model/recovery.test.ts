import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './project'
import { MemoryStorage } from './storage'
import {
  projectRecoveryKey,
  recoveryIndexKey,
  clearProjectRecovery,
  readProjectRecovery,
  writeProjectRecovery,
} from './recovery'

describe('project recovery', () => {
  const scope = 'local:anonymous'

  it('round-trips a revisioned project through synchronous storage', () => {
    const storage = new MemoryStorage()
    const project = createEmptyProject('recovery')
    project.name = 'Unsaved idea'

    const token = writeProjectRecovery(storage, scope, project, 4)

    expect(readProjectRecovery(storage, scope)).toMatchObject({
      token,
      revision: 4,
      project,
    })
  })

  it('clears only the exact recovery token owned by the successful save', () => {
    const storage = new MemoryStorage()
    const project = createEmptyProject('recovery')
    const token = writeProjectRecovery(storage, scope, project, 5)
    expect(token).not.toBeNull()

    clearProjectRecovery(storage, scope, project.id, 'another-writer')
    expect(storage.getItem(projectRecoveryKey(scope, project.id, token!))).not.toBeNull()

    clearProjectRecovery(storage, scope, project.id, token)
    expect(storage.getItem(projectRecoveryKey(scope, project.id, token!))).toBeNull()
  })

  it('ignores malformed recovery data', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      projectRecoveryKey(scope, 'bad', 'bad-token'),
      '{"version":1,"project":"bad"}',
    )
    expect(readProjectRecovery(storage, scope, 'bad')).toBeNull()
  })

  it('does not expose another identity recovery record', () => {
    const storage = new MemoryStorage()
    writeProjectRecovery(storage, 'remote:user-a', createEmptyProject('a'), 1)

    expect(readProjectRecovery(storage, 'remote:user-b')).toBeNull()
    expect(readProjectRecovery(storage, 'local:anonymous')).toBeNull()
  })

  it('keeps independent project records and advances the active pointer', () => {
    const storage = new MemoryStorage()
    const first = createEmptyProject('first')
    const second = createEmptyProject('second')
    const firstToken = writeProjectRecovery(storage, scope, first, 2)
    const secondToken = writeProjectRecovery(storage, scope, second, 3)

    expect(readProjectRecovery(storage, scope)?.project.id).toBe('second')
    expect(readProjectRecovery(storage, scope, 'first')?.revision).toBe(2)
    expect(readProjectRecovery(storage, scope, 'second')?.revision).toBe(3)

    clearProjectRecovery(storage, scope, 'second', secondToken)
    expect(readProjectRecovery(storage, scope)?.project.id).toBe('first')
    expect(readProjectRecovery(storage, scope, 'first')?.revision).toBe(2)
    expect(firstToken).not.toBeNull()
  })

  it('repairs missing, stale, and partially-cleared active pointers', () => {
    const storage = new MemoryStorage()
    const first = createEmptyProject('first')
    const second = createEmptyProject('second')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      const firstToken = writeProjectRecovery(storage, scope, first, 1)
      vi.setSystemTime(new Date(2_000))
      const secondToken = writeProjectRecovery(storage, scope, second, 2)

      storage.removeItem(recoveryIndexKey(scope))
      expect(readProjectRecovery(storage, scope)?.project.id).toBe('second')

      storage.setItem(
        recoveryIndexKey(scope),
        JSON.stringify({ version: 1, projectId: 'missing', token: 'missing' }),
      )
      expect(readProjectRecovery(storage, scope)?.project.id).toBe('second')

      storage.removeItem(projectRecoveryKey(scope, 'second', secondToken!))
      expect(readProjectRecovery(storage, scope)?.project.id).toBe('first')
      expect(firstToken).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('discovers a newer crash-written record even when the old pointer is valid', () => {
    const storage = new MemoryStorage()
    const first = createEmptyProject('first')
    const second = createEmptyProject('second')
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      const firstToken = writeProjectRecovery(storage, scope, first, 1)!
      vi.setSystemTime(new Date(2_000))
      const secondToken = writeProjectRecovery(storage, scope, second, 1)!
      storage.setItem(
        recoveryIndexKey(scope),
        JSON.stringify({ version: 1, projectId: first.id, token: firstToken }),
      )

      expect(readProjectRecovery(storage, scope)?.project.id).toBe(second.id)
      expect(storage.getItem(recoveryIndexKey(scope))).toContain(secondToken)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a newer competing writer when an older high revision clears its token', () => {
    const storage = new MemoryStorage()
    const first = createEmptyProject('shared-project')
    first.name = 'Writer A'
    const second = createEmptyProject('shared-project')
    second.name = 'Writer B'
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      const writerA = writeProjectRecovery(storage, scope, first, 5)!
      vi.setSystemTime(new Date(2_000))
      const writerB = writeProjectRecovery(storage, scope, second, 1)!

      clearProjectRecovery(storage, scope, first.id, writerA)

      expect(readProjectRecovery(storage, scope)?.token).toBe(writerB)
      expect(readProjectRecovery(storage, scope)?.project.name).toBe('Writer B')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the previous same-project token after clearing the newest exact token', () => {
    const storage = new MemoryStorage()
    const first = createEmptyProject('shared-project')
    first.name = 'First'
    const second = createEmptyProject('shared-project')
    second.name = 'Second'
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      const firstToken = writeProjectRecovery(storage, scope, first, 1)!
      vi.setSystemTime(new Date(2_000))
      const secondToken = writeProjectRecovery(storage, scope, second, 2)!

      clearProjectRecovery(storage, scope, second.id, secondToken)

      expect(readProjectRecovery(storage, scope)?.token).toBe(firstToken)
      expect(readProjectRecovery(storage, scope)?.project.name).toBe('First')
    } finally {
      vi.useRealTimers()
    }
  })
})
