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
    expect(storage.getItem(projectRecoveryKey(scope))).not.toBeNull()

    clearProjectRecovery(storage, scope, project.id, 5)
    expect(storage.getItem(projectRecoveryKey(scope))).toBeNull()
  })

  it('ignores malformed recovery data', () => {
    const storage = new MemoryStorage()
    storage.setItem(projectRecoveryKey(scope), '{"version":1,"project":"bad"}')
    expect(readProjectRecovery(storage, scope)).toBeNull()
  })

  it('does not expose another identity recovery record', () => {
    const storage = new MemoryStorage()
    writeProjectRecovery(storage, 'remote:user-a', createEmptyProject('a'), 1)

    expect(readProjectRecovery(storage, 'remote:user-b')).toBeNull()
    expect(readProjectRecovery(storage, 'local:anonymous')).toBeNull()
  })
})
