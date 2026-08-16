import { describe, expect, it } from 'vitest'
import {
  beginEmptyGesture,
  cancelEmptyGesture,
  endEmptyGesture,
  idleEmptyGesture,
  moveEmptyGesture,
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
    const up = endEmptyGesture(down.state, touch(20, 20))

    expect(up.state).toBe(idleEmptyGesture)
    expect(up.effects).toEqual([])
  })

  it('pans empty space after the travel threshold without adding a note', () => {
    const down = beginEmptyGesture(touch(20, 20), 'pan-select')
    const move = moveEmptyGesture(down.state, touch(40, 30))
    const up = endEmptyGesture(move.state, touch(40, 30))

    expect(move.effects).toEqual([{ type: 'pan-by', dx: 20, dy: 10 }])
    expect(up.effects).toEqual([])
  })

  it('adds exactly once on a low-travel Draw pointer-up', () => {
    const down = beginEmptyGesture(touch(20, 20), 'draw')
    const move = moveEmptyGesture(down.state, touch(24, 24))
    const up = endEmptyGesture(move.state, touch(24, 24))

    expect(move.effects).toEqual([])
    expect(up.effects).toEqual([
      { type: 'add-note', point: { x: 24, y: 24 } },
    ])
  })

  it('turns Draw movement into pan and never adds', () => {
    const down = beginEmptyGesture(touch(20, 20), 'draw')
    const move = moveEmptyGesture(down.state, touch(40, 20))
    const up = endEmptyGesture(move.state, touch(40, 20))

    expect(move.effects[0]?.type).toBe('pan-by')
    expect(up.effects).toEqual([])
  })

  it('ignores events from a different pointer', () => {
    const down = beginEmptyGesture(touch(10, 10, 7), 'draw')

    expect(moveEmptyGesture(down.state, touch(30, 10, 8))).toEqual({
      state: down.state,
      effects: [],
    })
    expect(endEmptyGesture(down.state, touch(10, 10, 8))).toEqual({
      state: down.state,
      effects: [],
    })
  })

  it('cancels only the owning empty-grid pointer', () => {
    const down = beginEmptyGesture(touch(10, 10, 7), 'draw')
    expect(cancelEmptyGesture(down.state, 8)).toEqual({
      state: down.state,
      effects: [],
    })
    expect(cancelEmptyGesture(down.state, 7)).toEqual({
      state: idleEmptyGesture,
      effects: [],
    })
  })
})
