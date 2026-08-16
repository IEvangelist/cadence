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

export type EmptyGestureState =
  | { kind: 'idle' }
  | EmptyGesture

export type EmptyGestureEffect =
  | { type: 'pan-by'; dx: number; dy: number }
  | { type: 'add-note'; point: GesturePoint }

export interface EmptyGestureTransition {
  state: EmptyGestureState
  effects: EmptyGestureEffect[]
}

export interface NoteGestureOptions {
  tapTravel?: number
}

const DEFAULT_TAP_TRAVEL = 8

export const idleEmptyGesture: EmptyGestureState = { kind: 'idle' }

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
  state: Exclude<EmptyGestureState, { kind: 'idle' }>,
  pointerId: number,
): boolean {
  return state.pointerId === pointerId
}

export function beginEmptyGesture(
  pointer: GesturePointer,
  mode: MobileNoteMode,
): EmptyGestureTransition {
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

export function moveEmptyGesture(
  state: EmptyGestureState,
  pointer: GesturePointer,
  options: NoteGestureOptions = {},
): EmptyGestureTransition {
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

  return {
    state: next,
    effects: [{ type: 'pan-by', dx, dy }],
  }
}

export function endEmptyGesture(
  state: EmptyGestureState,
  pointer: GesturePointer,
): EmptyGestureTransition {
  if (state.kind === 'idle' || !activePointer(state, pointer.pointerId)) {
    return { state, effects: [] }
  }

  const effects: EmptyGestureEffect[] = []
  if (state.mode === 'draw' && !state.moved) {
    effects.push({ type: 'add-note', point: pointer.point })
  }

  return { state: idleEmptyGesture, effects }
}

export function cancelEmptyGesture(
  state: EmptyGestureState,
  pointerId: number,
): EmptyGestureTransition {
  if (state.kind === 'idle' || !activePointer(state, pointerId)) {
    return { state, effects: [] }
  }

  return { state: idleEmptyGesture, effects: [] }
}
