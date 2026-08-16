import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './project'
import { MemoryStorage } from './storage'
import {
  PROJECT_RECOVERY_KEY,
  clearProjectRecovery,
  readProjectRecovery,
  writeProjectRecovery,
} from './recovery'

describe('project recovery', () => {
  it('round-trips a revisioned project through synchronous storage', () => {
    const storage = new MemoryStorage()
    const project = createEmptyProject('recovery')
    project.name = 'Unsaved idea'

    writeProjectRecovery(storage, project, 4)

    expect(readProjectRecovery(storage)).toEqual({ revision: 4, project })
  })

  it('clears only a recovery revision covered by the successful save', () => {
    const storage = new MemoryStorage()
    const project = createEmptyProject('recovery')
    writeProjectRecovery(storage, project, 5)

    clearProjectRecovery(storage, project.id, 4)
    expect(storage.getItem(PROJECT_RECOVERY_KEY)).not.toBeNull()

    clearProjectRecovery(storage, project.id, 5)
    expect(storage.getItem(PROJECT_RECOVERY_KEY)).toBeNull()
  })

  it('ignores malformed recovery data', () => {
    const storage = new MemoryStorage()
    storage.setItem(PROJECT_RECOVERY_KEY, '{"version":1,"project":"bad"}')
    expect(readProjectRecovery(storage)).toBeNull()
  })
})
