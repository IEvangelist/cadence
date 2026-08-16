import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_TIMEOUT_MS,
  DEFAULT_HISTORY_LIMIT,
  createHistoryController,
} from './history'

/** A tiny controllable clock so capture-window tests are deterministic. */
function fakeClock(start = 0) {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe('createHistoryController', () => {
  it('starts with nothing to undo or redo', () => {
    const history = createHistoryController<number>()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBeUndefined()
  })

  it('undo returns the before value and enables redo', () => {
    const history = createHistoryController<number>()
    history.push(0, 1)
    expect(history.canUndo()).toBe(true)
    expect(history.undo()).toBe(0)
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)
  })

  it('redo reapplies the after value', () => {
    const history = createHistoryController<number>()
    history.push(0, 1)
    history.undo()
    expect(history.redo()).toBe(1)
    expect(history.canRedo()).toBe(false)
    expect(history.canUndo()).toBe(true)
  })

  it('a new push clears the redo stack', () => {
    const history = createHistoryController<number>()
    history.push(0, 1)
    history.undo()
    expect(history.canRedo()).toBe(true)
    history.push(1, 2)
    expect(history.canRedo()).toBe(false)
  })

  it('undoing multiple entries walks back through each before value in order', () => {
    const history = createHistoryController<number>()
    history.push(0, 1, 'a')
    history.stopCapturing()
    history.push(1, 2, 'b')
    history.stopCapturing()
    history.push(2, 3, 'c')

    expect(history.undo()).toBe(2)
    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
    expect(history.undo()).toBeUndefined()
  })

  it('bounds the stack to the configured limit, dropping the oldest entries', () => {
    const history = createHistoryController<number>({ limit: 3 })
    for (let i = 0; i < 5; i += 1) {
      history.push(i, i + 1)
      history.stopCapturing() // each push is a discrete entry
    }
    let count = 0
    while (history.canUndo()) {
      history.undo()
      count += 1
    }
    expect(count).toBe(3)
  })

  it('uses DEFAULT_HISTORY_LIMIT and DEFAULT_CAPTURE_TIMEOUT_MS when unset', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(100)
    expect(DEFAULT_CAPTURE_TIMEOUT_MS).toBe(500)
    const history = createHistoryController<number>()
    for (let i = 0; i < DEFAULT_HISTORY_LIMIT + 10; i += 1) {
      history.push(i, i + 1)
      history.stopCapturing()
    }
    let count = 0
    while (history.canUndo()) {
      history.undo()
      count += 1
    }
    expect(count).toBe(DEFAULT_HISTORY_LIMIT)
  })

  it('coalesces rapid same-group pushes into a single undo entry (gesture drag)', () => {
    const clock = fakeClock()
    const history = createHistoryController<number>({ now: clock.now })

    // Simulate a pointer drag: many rapid `update-note`-style pushes for the
    // same note, each only a few ms apart.
    history.push(0, 1, 'update-note:track:note1')
    clock.advance(10)
    history.push(1, 2, 'update-note:track:note1')
    clock.advance(10)
    history.push(2, 3, 'update-note:track:note1')
    clock.advance(10)
    history.push(3, 4, 'update-note:track:note1')

    // The whole drag collapses into ONE undo step: back to the value before
    // the gesture started, not just the last micro-step.
    expect(history.undo()).toBe(0)
    expect(history.canUndo()).toBe(false)
  })

  it('does not coalesce pushes with different group keys even if rapid', () => {
    const clock = fakeClock()
    const history = createHistoryController<number>({ now: clock.now })

    history.push(0, 1, 'update-note:track:note1')
    clock.advance(10)
    history.push(10, 11, 'update-note:track:note2')

    expect(history.undo()).toBe(10)
    expect(history.undo()).toBe(0)
  })

  it('does not coalesce discrete pushes with no group key, even rapid ones', () => {
    const clock = fakeClock()
    const history = createHistoryController<number>({ now: clock.now })

    history.push(0, 1)
    clock.advance(1)
    history.push(1, 2)

    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
  })

  it('starts a new entry once the capture window elapses, even for the same group', () => {
    const clock = fakeClock()
    const history = createHistoryController<number>({
      now: clock.now,
      captureTimeoutMs: 100,
    })

    history.push(0, 1, 'set-tempo')
    clock.advance(200) // outside the capture window
    history.push(1, 2, 'set-tempo')

    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
  })

  it('stopCapturing forces the next push to start a new entry', () => {
    const clock = fakeClock()
    const history = createHistoryController<number>({ now: clock.now })

    history.push(0, 1, 'set-loop')
    history.stopCapturing()
    clock.advance(1) // still well within the capture window
    history.push(1, 2, 'set-loop')

    expect(history.undo()).toBe(1)
    expect(history.undo()).toBe(0)
  })

  it('clear() discards both stacks', () => {
    const history = createHistoryController<number>()
    history.push(0, 1)
    history.undo()
    expect(history.canRedo()).toBe(true)
    history.push(5, 6)
    history.clear()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })

  it('undo after clear is a no-op', () => {
    const history = createHistoryController<number>()
    history.push(0, 1)
    history.clear()
    expect(history.undo()).toBeUndefined()
  })
})
