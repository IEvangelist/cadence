import { describe, expect, it } from 'vitest'
import type { CollaborationState } from '../model/collab/useCollaboration'
import type { CollabPresence } from '../model/collab/collabSession'
import {
  projectParticipant,
  selectCollaborationStatus,
  presenceProjectsToParticipant,
  rolesAligned,
  selectorConformsToContract,
} from './collaborationSelector'

describe('collaboration selector (post-#9 binding)', () => {
  it('holds the compile-time boundary proofs at runtime', () => {
    expect(rolesAligned).toBe(true)
    expect(presenceProjectsToParticipant).toBe(true)
    expect(selectorConformsToContract).toBe(true)
  })

  it('projects a #9 presence entry into the public Participant (per-connection id, no role)', () => {
    const presence: CollabPresence = {
      clientId: 7,
      user: { id: 'user_hicks', name: 'Hicks', color: '#00d1b2' },
      cursor: { trackId: 'track_1', selectedNoteIds: ['n1'] },
      isSelf: true,
    }

    const participant = projectParticipant(presence)

    expect(participant).toEqual({
      id: '7',
      userId: 'user_hicks',
      displayName: 'Hicks',
      color: '#00d1b2',
      isSelf: true,
    })
    expect(participant.role).toBeUndefined()
  })

  it('projects live CollaborationState into the public CollaborationStatus', () => {
    const state: CollaborationState = {
      active: true,
      connected: true,
      canWrite: true,
      presence: [
        { clientId: 1, user: { id: 'u1', name: 'Ripley', color: '#f00' }, cursor: null, isSelf: true },
        { clientId: 2, user: { id: 'u2', name: 'Newt', color: '#0f0' }, cursor: null, isSelf: false },
      ],
    }

    const status = selectCollaborationStatus(state, { role: 'editor', canShare: true })

    expect(status.isActive).toBe(true)
    expect(status.role).toBe('editor')
    expect(status.canShare).toBe(true)
    expect(status.participants).toHaveLength(2)
    expect(status.participants[0]).toMatchObject({ id: '1', userId: 'u1', displayName: 'Ripley', isSelf: true })
    expect(status.participants[1].isSelf).toBe(false)
  })

  it('reports the solo/offline default from an inert state', () => {
    const inert: CollaborationState = { active: false, connected: false, canWrite: false, presence: [] }

    const status = selectCollaborationStatus(inert, { role: 'owner', canShare: false })

    expect(status).toEqual({ canShare: false, isActive: false, role: 'owner', participants: [] })
  })
})
