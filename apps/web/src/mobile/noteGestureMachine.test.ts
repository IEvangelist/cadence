import { describe, expect, it } from 'vitest'
import {
  beginEmptyGesture,
  beginNoteGesture,
  cancelNoteGesture,
  endNoteGesture,
  idleNoteGesture,
  moveNoteGesture,
  usesDirectGridAdd,
  type GesturePointer,
} from './noteGestureMachine'

const touch = (
  x: number,
  y: number,
  pointerId = 1,
): GesturePointer => ({
  pointerId,
  pointerType: 'touch',
  point: { x, y },
})

describe('note gesture state machine', () => {
  it('never adds from an empty Pan/Select tap', () => {
    const down = beginEmptyGesture(touch(20, 20), 'pan-select')
    const up = endNoteGesture(down.state, touch(20, 20))

    expect(up.state).toBe(idleNoteGesture)
    expect(up.effects).toEqual([])
  })

  it('pans empty space after the travel threshold without adding a note', () => {
    const down = beginEmptyGesture(touch(20, 20), 'pan-select')
    const move = moveNoteGesture(down.state, touch(40, 30))
    const up = endNoteGesture(move.state, touch(40, 30))

    expect(move.effects).toEqual([{ type: 'pan-by', dx: 20, dy: 10 }])
    expect(up.effects).toEqual([])
  })

  it('adds exactly once on a low-travel Draw pointer-up', () => {
    const down = beginEmptyGesture(touch(20, 20), 'draw')
    const move = moveNoteGesture(down.state, touch(24, 24))
    const up = endNoteGesture(move.state, touch(24, 24))

    expect(move.effects).toEqual([])
    expect(up.effects).toEqual([
      { type: 'add-note', point: { x: 24, y: 24 } },
    ])
  })

  it('turns Draw movement into pan and never adds', () => {
    const down = beginEmptyGesture(touch(20, 20), 'draw')
    const move = moveNoteGesture(down.state, touch(40, 20))
    const up = endNoteGesture(move.state, touch(40, 20))

    expect(move.effects[0]?.type).toBe('pan-by')
    expect(up.effects).toEqual([])
  })

  it('selects, captures, moves, and releases a note', () => {
    const down = beginNoteGesture(touch(10, 10, 7), 'note-1')
    const move = moveNoteGesture(down.state, touch(24, 18, 7))
    const up = endNoteGesture(move.state, touch(24, 18, 7))

    expect(down.effects).toEqual([
      { type: 'select-note', noteId: 'note-1' },
      { type: 'capture-pointer', pointerId: 7 },
    ])
    expect(move.effects).toEqual([
      { type: 'move-note', noteId: 'note-1', dx: 14, dy: 8 },
    ])
    expect(up.effects).toEqual([{ type: 'release-pointer', pointerId: 7 }])
  })

  it('cancels a captured note move into a valid idle state', () => {
    const down = beginNoteGesture(touch(10, 10, 7), 'note-1')
    const cancelled = cancelNoteGesture(down.state, 7)

    expect(cancelled.state).toBe(idleNoteGesture)
    expect(cancelled.effects).toEqual([
      { type: 'cancel-note-move', noteId: 'note-1' },
      { type: 'release-pointer', pointerId: 7 },
    ])
  })

  it('ignores events from a different pointer', () => {
    const down = beginEmptyGesture(touch(10, 10, 7), 'draw')

    expect(moveNoteGesture(down.state, touch(30, 10, 8))).toEqual({
      state: down.state,
      effects: [],
    })
    expect(endNoteGesture(down.state, touch(10, 10, 8))).toEqual({
      state: down.state,
      effects: [],
    })
  })

  it('keeps direct grid add limited to mouse pointers', () => {
    expect(usesDirectGridAdd('mouse')).toBe(true)
    expect(usesDirectGridAdd('touch')).toBe(false)
    expect(usesDirectGridAdd('pen')).toBe(false)
  })
})

