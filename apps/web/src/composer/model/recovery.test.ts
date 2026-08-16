import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './project'
import { MemoryStorage } from './storage'
import {
  projectRecoveryKey,
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

    writeProjectRecovery(storage, scope, project, 4)

    expect(readProjectRecovery(storage, scope)).toEqual({ revision: 4, project })
  })

  it('clears only a recovery revision covered by the successful save', () => {
    const storage = new MemoryStorage()
    const project = createEmptyProject('recovery')
    writeProjectRecovery(storage, scope, project, 5)

    clearProjectRecovery(storage, scope, project.id, 4)
    expect(storage.getItem(projectRecoveryKey(scope, project.id))).not.toBeNull()

    clearProjectRecovery(storage, scope, project.id, 5)
    expect(storage.getItem(projectRecoveryKey(scope, project.id))).toBeNull()
  })

  it('ignores malformed recovery data', () => {
    const storage = new MemoryStorage()
    storage.setItem(projectRecoveryKey(scope, 'bad'), '{"version":1,"project":"bad"}')
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
    writeProjectRecovery(storage, scope, first, 2)
    writeProjectRecovery(storage, scope, second, 3)

    expect(readProjectRecovery(storage, scope)?.project.id).toBe('second')
    expect(readProjectRecovery(storage, scope, 'first')?.revision).toBe(2)
    expect(readProjectRecovery(storage, scope, 'second')?.revision).toBe(3)

    clearProjectRecovery(storage, scope, 'second', 3)
    expect(readProjectRecovery(storage, scope)?.project.id).toBe('first')
    expect(readProjectRecovery(storage, scope, 'first')?.revision).toBe(2)
  })
})
