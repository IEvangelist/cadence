import type { MobileNoteMode } from './mobileTaskModel'

export interface GesturePoint {
  x: number
  y: number
}

export interface GesturePointer {
  pointerId: number
  pointerType: string
  point: GesturePoint
}

interface EmptyGesture {
  kind: 'empty'
  pointerId: number
  pointerType: string
  mode: MobileNoteMode
  origin: GesturePoint
  last: GesturePoint
  moved: boolean
}

interface NoteGesture {
  kind: 'note'
  pointerId: number
  pointerType: string
  noteId: string
  origin: GesturePoint
  last: GesturePoint
  moved: boolean
}

export type NoteGestureState =
  | { kind: 'idle' }
  | EmptyGesture
  | NoteGesture

export type NoteGestureEffect =
  | { type: 'capture-pointer'; pointerId: number }
  | { type: 'release-pointer'; pointerId: number }
  | { type: 'pan-by'; dx: number; dy: number }
  | { type: 'add-note'; point: GesturePoint }
  | { type: 'select-note'; noteId: string }
  | {
      type: 'move-note'
      noteId: string
      dx: number
      dy: number
    }
  | { type: 'cancel-note-move'; noteId: string }

export interface NoteGestureTransition {
  state: NoteGestureState
  effects: NoteGestureEffect[]
}

export interface NoteGestureOptions {
  tapTravel?: number
}

const DEFAULT_TAP_TRAVEL = 8

export const idleNoteGesture: NoteGestureState = { kind: 'idle' }

function traveledBeyond(
  origin: GesturePoint,
  point: GesturePoint,
  threshold: number,
): boolean {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return dx * dx + dy * dy > threshold * threshold
}

function activePointer(
  state: Exclude<NoteGestureState, { kind: 'idle' }>,
  pointerId: number,
): boolean {
  return state.pointerId === pointerId
}

export function beginEmptyGesture(
  pointer: GesturePointer,
  mode: MobileNoteMode,
): NoteGestureTransition {
  return {
    state: {
      kind: 'empty',
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      mode,
      origin: pointer.point,
      last: pointer.point,
      moved: false,
    },
    effects: [],
  }
}

export function beginNoteGesture(
  pointer: GesturePointer,
  noteId: string,
): NoteGestureTransition {
  return {
    state: {
      kind: 'note',
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      noteId,
      origin: pointer.point,
      last: pointer.point,
      moved: false,
    },
    effects: [
      { type: 'select-note', noteId },
      { type: 'capture-pointer', pointerId: pointer.pointerId },
    ],
  }
}

export function moveNoteGesture(
  state: NoteGestureState,
  pointer: GesturePointer,
  options: NoteGestureOptions = {},
): NoteGestureTransition {
  if (state.kind === 'idle' || !activePointer(state, pointer.pointerId)) {
    return { state, effects: [] }
  }

  const moved =
    state.moved ||
    traveledBeyond(state.origin, pointer.point, options.tapTravel ?? DEFAULT_TAP_TRAVEL)
  const dx = pointer.point.x - state.last.x
  const dy = pointer.point.y - state.last.y
  const next = { ...state, last: pointer.point, moved }

  if (!moved) return { state: next, effects: [] }

  if (state.kind === 'empty') {
    return {
      state: next,
      effects: [{ type: 'pan-by', dx, dy }],
    }
  }

  return {
    state: next,
    effects: [
      {
        type: 'move-note',
        noteId: state.noteId,
        dx: pointer.point.x - state.origin.x,
        dy: pointer.point.y - state.origin.y,
      },
    ],
  }
}

export function endNoteGesture(
  state: NoteGestureState,
  pointer: GesturePointer,
): NoteGestureTransition {
  if (state.kind === 'idle' || !activePointer(state, pointer.pointerId)) {
    return { state, effects: [] }
  }

  const effects: NoteGestureEffect[] = []
  if (state.kind === 'empty' && state.mode === 'draw' && !state.moved) {
    effects.push({ type: 'add-note', point: pointer.point })
  }
  if (state.kind === 'note') {
    effects.push({ type: 'release-pointer', pointerId: pointer.pointerId })
  }

  return { state: idleNoteGesture, effects }
}

export function cancelNoteGesture(
  state: NoteGestureState,
  pointerId: number,
): NoteGestureTransition {
  if (state.kind === 'idle' || !activePointer(state, pointerId)) {
    return { state, effects: [] }
  }

  const effects: NoteGestureEffect[] = []
  if (state.kind === 'note') {
    effects.push(
      { type: 'cancel-note-move', noteId: state.noteId },
      { type: 'release-pointer', pointerId },
    )
  }

  return { state: idleNoteGesture, effects }
}

export function usesDirectGridAdd(pointerType: string): boolean {
  return pointerType === 'mouse'
}

