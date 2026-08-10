import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import type { CollaborationStatus } from './collaboration'
import { CollaborationStatusContext, useCollaborationStatus } from './collaborationContext'

describe('useCollaborationStatus (context-backed public read)', () => {
  it('returns the solo/offline default outside a <Composer> provider', () => {
    const { result } = renderHook(() => useCollaborationStatus())

    expect(result.current).toEqual({
      canShare: false,
      isActive: false,
      role: 'owner',
      participants: [],
    })
  })

  it('returns the status published by the nearest provider (single source, no re-connect)', () => {
    const published: CollaborationStatus = {
      canShare: true,
      isActive: true,
      role: 'editor',
      participants: [
        { id: '1', userId: 'u1', displayName: 'Ripley', color: '#f00', isSelf: true },
        { id: '2', userId: 'u2', displayName: 'Newt', color: '#0f0', isSelf: false },
      ],
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CollaborationStatusContext.Provider value={published}>{children}</CollaborationStatusContext.Provider>
    )

    const { result } = renderHook(() => useCollaborationStatus(), { wrapper })

    expect(result.current).toBe(published)
    expect(result.current.participants).toHaveLength(2)
    expect(result.current.role).toBe('editor')
  })
})
