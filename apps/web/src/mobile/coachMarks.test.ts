import { describe, expect, it } from 'vitest'
import {
  COACH_MARKS_STORAGE_KEY,
  MemoryCoachMarkStorage,
  markCoachMarkSeen,
  nextCoachMark,
  readSeenCoachMarks,
  type CoachMarkStorage,
} from './coachMarks'

class ThrowingStorage implements CoachMarkStorage {
  getItem(): string | null {
    throw new Error('denied')
  }

  setItem(): void {
    throw new Error('denied')
  }
}

describe('coach mark model', () => {
  it('returns only unseen guidance for the active task', () => {
    const seen = new Set<'project-actions'>(['project-actions'])

    expect(nextCoachMark('project', seen)).toBeNull()
    expect(nextCoachMark('notes', seen)?.id).toBe('note-modes')
  })

  it('persists a compact list of seen coach marks', () => {
    const storage = new MemoryCoachMarkStorage()
    const next = markCoachMarkSeen(storage, new Set(), 'note-modes')

    expect(next).toEqual(new Set(['note-modes']))
    expect(storage.getItem(COACH_MARKS_STORAGE_KEY)).toBe('["note-modes"]')
    expect(readSeenCoachMarks(storage)).toEqual(new Set(['note-modes']))
  })

  it('ignores malformed, stale, and unavailable storage', () => {
    const storage = new MemoryCoachMarkStorage()
    storage.setItem(COACH_MARKS_STORAGE_KEY, '["note-modes","removed-mark",4]')

    expect(readSeenCoachMarks(storage)).toEqual(new Set(['note-modes']))
    expect(readSeenCoachMarks(new ThrowingStorage())).toEqual(new Set())
    expect(() =>
      markCoachMarkSeen(new ThrowingStorage(), new Set(), 'note-modes'),
    ).not.toThrow()
  })
})
