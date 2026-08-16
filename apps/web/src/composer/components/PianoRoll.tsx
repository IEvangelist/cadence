import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react'
import { MAX_PITCH, MIN_PITCH, isBlackKey, pitchToName } from '../model/project'
import { getInstrument, drumLabel } from '../instruments/registry'
import { type ComposerController } from '../hooks/useComposer'
import type { SuggestedNote } from '../ai/types'
import {
  beginEmptyGesture,
  cancelNoteGesture,
  endNoteGesture,
  idleNoteGesture,
  moveNoteGesture,
  type NoteGestureState,
} from '../../mobile/noteGestureMachine'
import type { MobileNoteMode } from '../../mobile/mobileTaskModel'
import {
  DEFAULT_LAYOUT,
  ZOOM_STEP,
  beatToX,
  clampZoom,
  noteRect,
  scaleLayout,
  snap as snapBeat,
  snapFloor,
  xToBeat,
} from '../timing/timing'

interface PianoRollProps {
  controller: ComposerController
  /** Ghost notes from a pending AI suggestion, rendered visually distinct. */
  previewNotes?: SuggestedNote[]
  /** Touch-safe phone mode. Mouse input keeps the established direct-add path. */
  mobileNoteMode?: MobileNoteMode
}

/** A drag on a note's body (move) or one of its two resize edges. */
interface NoteGesture {
  kind: 'move' | 'resize-end' | 'resize-start'
  noteId: string
  startX: number
  startY: number
  origStart: number
  origPitch: number
  origDuration: number
  pointerId?: number
  captureTarget?: HTMLElement
}

/** A vertical drag on a velocity-lane bar. */
interface VelocityGesture {
  kind: 'velocity'
  noteId: string
  laneTop: number
  laneHeight: number
  pointerId?: number
  captureTarget?: HTMLElement
}

type Gesture = NoteGesture | VelocityGesture

const clampPitch = (p: number): number => Math.min(MAX_PITCH, Math.max(MIN_PITCH, p))
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const round2 = (v: number): number => Math.round(v * 100) / 100
const TOTAL_ROWS = MAX_PITCH - MIN_PITCH + 1

/**
 * A pitch window of `rows` rows centred on `center`, clamped to the real
 * [MIN_PITCH, MAX_PITCH] range. When the desired window runs off an edge it
 * slides back in so the full row count is preserved (until it fills the whole
 * keyboard), keeping the grid free of dead, un-keyed space.
 */
function pitchWindow(center: number, rows: number): { low: number; high: number } {
  const span = Math.min(Math.max(Math.round(rows), 1), TOTAL_ROWS)
  let high = center + Math.floor(span / 2)
  let low = high - span + 1
  if (high > MAX_PITCH) {
    high = MAX_PITCH
    low = high - span + 1
  }
  if (low < MIN_PITCH) {
    low = MIN_PITCH
    high = low + span - 1
  }
  return { low: Math.max(MIN_PITCH, low), high: Math.min(MAX_PITCH, high) }
}

/**
 * DOM-based piano roll — chosen over canvas so notes are real focusable
 * elements and the whole editor is keyboard-accessible and axe-clean. All
 * geometry comes from the pure timing helpers.
 */
export function PianoRoll({
  controller,
  previewNotes = [],
  mobileNoteMode,
}: PianoRollProps) {
  const {
    project,
    selectedTrackId,
    state,
    snap,
    addNoteAt,
    updateNote,
    removeNote,
    quantizeNotes,
    selectNote,
    previewNote,
    positionBeats,
    transportState,
    revealRequest,
    visibleTrackIds,
    stopHistoryCapture,
  } = controller

  const track =
    project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const isDrum = track ? getInstrument(track.instrumentId).kind === 'drum' : false
  // The whole selection highlights (an accepted AI batch selects every inserted
  // note); the first selected note still drives the velocity editor and the
  // keyboard Delete/caret affordances.
  const selectedNoteIds = state.selectedNoteIds
  const selectedSet = new Set(selectedNoteIds)
  const selectedNoteId = selectedNoteIds[0] ?? null
  const selectedNote = track?.notes.find((n) => n.id === selectedNoteId)

  // #131 multi-track view. `visibleTrackIds` (memoized in the controller) always
  // includes the active track; the OTHER visible tracks render as read-only,
  // color-coded "ghost" context underneath the editable notes. Deriving these
  // via useMemo keeps note edits (which don't change the visible set) from
  // recomputing the overlay. Ghost tracks are DISPLAY-ONLY — they carry no
  // gesture handlers and are pointer-events:none, so only the active track is
  // ever hit-testable (drag/resize/velocity can't touch a ghost).
  const activeTrackId = track?.id
  const visibleTrackIdSet = useMemo(() => new Set(visibleTrackIds), [visibleTrackIds])
  const visibleTracks = useMemo(
    () => project.tracks.filter((t) => visibleTrackIdSet.has(t.id)),
    [project.tracks, visibleTrackIdSet],
  )
  const ghostTracks = useMemo(
    () => visibleTracks.filter((t) => t.id !== activeTrackId),
    [visibleTracks, activeTrackId],
  )
  const isMultiTrack = visibleTracks.length > 1

  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const velScrollRef = useRef<HTMLDivElement>(null)
  const velLaneRef = useRef<HTMLDivElement>(null)
  const didAutoScrollRef = useRef(false)
  const gestureRef = useRef<Gesture | null>(null)
  const emptyGestureRef = useRef<NoteGestureState>(idleNoteGesture)
  const [caret, setCaret] = useState({ pitch: 60, beat: 0 })
  const [viewportRows, setViewportRows] = useState(0)

  // Independent horizontal (time) and vertical (pitch) zoom. Both scale the pure
  // DEFAULT_LAYOUT — the audio engine schedules by TIME only, so zoom is purely
  // visual and never affects playback (#97-safe).
  const [zoomX, setZoomX] = useState(1)
  const [zoomY, setZoomY] = useState(1)
  const layout = useMemo(() => scaleLayout(DEFAULT_LAYOUT, zoomX, zoomY), [zoomX, zoomY])

  const [showVelocity, setShowVelocity] = useState(true)
  const [quantizeStrength, setQuantizeStrength] = useState(1)

  const snapStep = snap > 0 ? snap : 1
  const width = project.lengthBeats * layout.beatWidth

  // Fit-to-content vertical window: rendering the full 88-key range leaves the
  // roll mostly empty staff. Clamp the rendered rows to the pitches actually in
  // use (± a margin), defaulting to a ~2-octave window around middle C when the
  // track is empty. The window then GROWS to at least fill the visible viewport
  // height (measured below) so the grid never leaves dead space under the notes —
  // every rendered row is real, keyed, clickable staff. The audio engine
  // schedules by TIME only, so this vertical windowing never affects playback.
  const PITCH_MARGIN = 4
  const MIN_PITCH_SPAN = 24
  // Fit the vertical window to EVERY visible track's notes (active + ghosts) so
  // overlaid context notes land on real, rendered rows instead of clipping above
  // or below the grid. With only the active track visible this is identical to
  // the previous single-track behaviour.
  const notePitches = [
    ...(track?.notes ?? []),
    ...ghostTracks.flatMap((t) => t.notes),
  ].map((n) => n.pitch)
  const usedLow = notePitches.length > 0 ? Math.min(...notePitches) - PITCH_MARGIN : 54
  const usedHigh = notePitches.length > 0 ? Math.max(...notePitches) + PITCH_MARGIN : 78
  const contentCenter = Math.round((usedLow + usedHigh) / 2)
  const contentRows = Math.max(usedHigh - usedLow + 1, MIN_PITCH_SPAN)
  const desiredRows = Math.max(contentRows, viewportRows)
  const { low: bottomPitch, high: topPitch } = pitchWindow(contentCenter, desiredRows)
  const visibleRows = topPitch - bottomPitch + 1
  const rowOfPitch = (pitch: number): number => topPitch - pitch
  const yToWindowPitch = (y: number): number =>
    clampPitch(topPitch - Math.floor(y / layout.rowHeight))
  const clampToWindow = (pitch: number): number =>
    Math.min(topPitch, Math.max(bottomPitch, pitch))
  const height = visibleRows * layout.rowHeight

  // Keep live values reachable from the (mount-installed) window pointer
  // handlers without re-installing them on every render. The ref is written in
  // an effect, never during render, to satisfy the React Compiler rules.
  const latest = useRef({ track, snap: snapStep, updateNote, layout, stopHistoryCapture })
  useEffect(() => {
    latest.current = { track, snap: snapStep, updateNote, layout, stopHistoryCapture }
  })

  useEffect(() => {
    const handleMove = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current
      const { track: t, snap: step, updateNote: update, layout: lay } = latest.current
      if (!gesture || !t) return
      if (gesture.pointerId !== undefined && event.pointerId !== gesture.pointerId) return

      if (gesture.kind === 'velocity') {
        const velocity = clamp01(1 - (event.clientY - gesture.laneTop) / gesture.laneHeight)
        update(t.id, gesture.noteId, { velocity: round2(velocity) })
        return
      }

      const dBeat = (event.clientX - gesture.startX) / lay.beatWidth
      if (gesture.kind === 'move') {
        // Ignore sub-threshold pointer travel so a click-to-select doesn't nudge.
        if (
          Math.abs(event.clientX - gesture.startX) < 3 &&
          Math.abs(event.clientY - gesture.startY) < 3
        )
          return
        const dRows = Math.round((event.clientY - gesture.startY) / lay.rowHeight)
        update(t.id, gesture.noteId, {
          start: snapBeat(gesture.origStart + dBeat, step),
          pitch: clampPitch(gesture.origPitch - dRows),
        })
      } else if (gesture.kind === 'resize-end') {
        update(t.id, gesture.noteId, {
          duration: Math.max(step, snapBeat(gesture.origDuration + dBeat, step)),
        })
      } else {
        // resize-start: drag the left edge, holding the note's END fixed.
        const origEnd = gesture.origStart + gesture.origDuration
        const rawStart = Math.max(0, gesture.origStart + dBeat)
        const newStart = Math.max(0, Math.min(snapBeat(rawStart, step), origEnd - step))
        update(t.id, gesture.noteId, {
          start: newStart,
          duration: Math.max(step, origEnd - newStart),
        })
      }
    }
    const finishGesture = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current
      if (
        gesture?.pointerId !== undefined &&
        event.pointerId !== gesture.pointerId
      ) {
        return
      }
      if (gesture) {
        if (
          gesture.pointerId !== undefined &&
          gesture.captureTarget?.hasPointerCapture(gesture.pointerId)
        ) {
          gesture.captureTarget.releasePointerCapture(gesture.pointerId)
        }
        latest.current.stopHistoryCapture()
      }
      gestureRef.current = null
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', finishGesture)
    window.addEventListener('pointercancel', finishGesture)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', finishGesture)
      window.removeEventListener('pointercancel', finishGesture)
    }
  }, [])

  // Measure the scroll viewport so the pitch window can grow to fill it (no dead
  // vertical space below the notes). jsdom has no ResizeObserver and reports zero
  // height, so this is a no-op in unit tests — the content window is used instead.
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const measure = () =>
      setViewportRows(Math.floor(scroller.clientHeight / layout.rowHeight))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [layout.rowHeight])

  // #98: on first render that has seeded notes, scroll the roll so those notes are
  // in view. The grid spans all 128 pitches, so it otherwise opens at the top (C8)
  // while the demo's C4–G4 content sits mid-grid, out of sight. Runs once, then
  // never fights the user's own scrolling.
  useEffect(() => {
    if (didAutoScrollRef.current) return
    const scroller = scrollRef.current
    const notes = track?.notes ?? []
    if (!scroller || notes.length === 0) return

    const pitches = notes.map((note) => note.pitch)
    const centerPitch = Math.round((Math.max(...pitches) + Math.min(...pitches)) / 2)
    const centerY = (topPitch - centerPitch) * layout.rowHeight + layout.rowHeight / 2
    scroller.scrollTop = Math.max(0, centerY - scroller.clientHeight / 2)
    didAutoScrollRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on first seeded render; topPitch tracks `track`
  }, [track])

  // #101: when a batch of notes is inserted (e.g. an accepted AI suggestion),
  // scroll the freshly placed region into view on BOTH axes. `Generate` anchors
  // new melodies after the existing content, so the region is frequently
  // off-viewport and the accept looks like a no-op. Token-gated so it fires once
  // per insert (never on mount — token starts at 0 — and idempotent under
  // StrictMode's double-invoke). Geometry is pure timing math, so it works before
  // the browser paints the new notes.
  useEffect(() => {
    if (revealRequest.token === 0) return
    const scroller = scrollRef.current
    if (!scroller) return
    const inserted = (track?.notes ?? []).filter((note) =>
      revealRequest.noteIds.includes(note.id),
    )
    if (inserted.length === 0) return

    const starts = inserted.map((note) => note.start)
    const minStart = Math.min(...starts)
    // Lead-in margin of one beat so the region isn't flush against the edge.
    scroller.scrollLeft = Math.max(0, beatToX(minStart, layout) - layout.beatWidth)

    const pitches = inserted.map((note) => note.pitch)
    const centerPitch = Math.round((Math.max(...pitches) + Math.min(...pitches)) / 2)
    const centerY = (topPitch - centerPitch) * layout.rowHeight + layout.rowHeight / 2
    scroller.scrollTop = Math.max(0, centerY - scroller.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on token bump only, not on every note edit
  }, [revealRequest.token])

  const beginGesture = (gesture: Gesture): void => {
    if (gestureRef.current) return
    stopHistoryCapture()
    gestureRef.current = gesture
  }

  const capturedPointer = (event: PointerEvent): Pick<Gesture, 'pointerId' | 'captureTarget'> => {
    if (!event.pointerType || event.pointerType === 'mouse') return {}
    const captureTarget = event.currentTarget as HTMLElement
    captureTarget.setPointerCapture(event.pointerId)
    return {
      pointerId: event.pointerId,
      captureTarget,
    }
  }

  const startMove = (event: PointerEvent, noteId: string): void => {
    if (
      !track ||
      gestureRef.current ||
      emptyGestureRef.current.kind !== 'idle'
    ) return
    event.stopPropagation()
    const note = track.notes.find((n) => n.id === noteId)
    if (!note) return
    selectNote(noteId)
    beginGesture({
      kind: 'move',
      noteId,
      startX: event.clientX,
      startY: event.clientY,
      origStart: note.start,
      origPitch: note.pitch,
      origDuration: note.duration,
      ...capturedPointer(event),
    })
  }

  const startResize = (
    event: PointerEvent,
    noteId: string,
    edge: 'start' | 'end',
  ): void => {
    if (
      !track ||
      gestureRef.current ||
      emptyGestureRef.current.kind !== 'idle'
    ) return
    event.stopPropagation()
    const note = track.notes.find((n) => n.id === noteId)
    if (!note) return
    selectNote(noteId)
    beginGesture({
      kind: edge === 'start' ? 'resize-start' : 'resize-end',
      noteId,
      startX: event.clientX,
      startY: event.clientY,
      origStart: note.start,
      origPitch: note.pitch,
      origDuration: note.duration,
      ...capturedPointer(event),
    })
  }

  const startVelocity = (event: PointerEvent, noteId: string): void => {
    if (
      !track ||
      gestureRef.current ||
      emptyGestureRef.current.kind !== 'idle'
    ) return
    event.stopPropagation()
    const lane = velLaneRef.current
    if (!lane) return
    const rect = lane.getBoundingClientRect()
    selectNote(noteId)
    beginGesture({
      kind: 'velocity',
      noteId,
      laneTop: rect.top,
      laneHeight: rect.height,
      ...capturedPointer(event),
    })
    const velocity = clamp01(1 - (event.clientY - rect.top) / rect.height)
    updateNote(track.id, noteId, { velocity: round2(velocity) })
  }

  const addAtPoint = (event: PointerEvent): void => {
    if (!track || !gridRef.current) return
    const rect = gridRef.current.getBoundingClientRect()
    const beat = snapFloor(xToBeat(event.clientX - rect.left, layout), snapStep)
    const pitch = yToWindowPitch(event.clientY - rect.top)
    setCaret({ pitch, beat })
    addNoteAt(track.id, pitch, beat, Math.max(snapStep, 1))
    previewNote(pitch)
  }

  const pointInGrid = (event: PointerEvent) => {
    const rect = gridRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  const startEmptyTouch = (event: PointerEvent): void => {
    if (
      event.target !== event.currentTarget ||
      gestureRef.current ||
      emptyGestureRef.current.kind !== 'idle'
    ) return
    if (
      !event.pointerType ||
      event.pointerType === 'mouse' ||
      mobileNoteMode === undefined
    ) {
      addAtPoint(event)
      return
    }
    emptyGestureRef.current = beginEmptyGesture(
      {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        point: pointInGrid(event),
      },
      mobileNoteMode,
    ).state
  }

  const moveEmptyTouch = (event: PointerEvent): void => {
    emptyGestureRef.current = moveNoteGesture(emptyGestureRef.current, {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      point: pointInGrid(event),
    }).state
  }

  const endEmptyTouch = (event: PointerEvent): void => {
    const transition = endNoteGesture(emptyGestureRef.current, {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      point: pointInGrid(event),
    })
    emptyGestureRef.current = transition.state
    if (transition.effects.some((effect) => effect.type === 'add-note')) {
      addAtPoint(event)
    }
  }

  const cancelEmptyTouch = (event: PointerEvent): void => {
    emptyGestureRef.current = cancelNoteGesture(
      emptyGestureRef.current,
      event.pointerId,
    ).state
  }

  const zoomTime = (factor: number): void => setZoomX((z) => clampZoom(z * factor))
  const zoomPitch = (factor: number): void => setZoomY((z) => clampZoom(z * factor))
  const resetZoom = (): void => {
    setZoomX(1)
    setZoomY(1)
  }

  const runQuantize = (): void => {
    if (!track) return
    const noteIds = selectedNoteIds.length > 0 ? selectedNoteIds : undefined
    quantizeNotes(track.id, { grid: snapStep, strength: quantizeStrength, noteIds })
  }

  // Keep the velocity lane horizontally aligned with the grid: mirror the grid's
  // scrollLeft onto the (overflow-hidden) velocity scroller. One-way, so there is
  // no scroll feedback loop, and the lane has no scrollbar of its own.
  const syncVelocityScroll = (): void => {
    const grid = scrollRef.current
    const vel = velScrollRef.current
    if (grid && vel) vel.scrollLeft = grid.scrollLeft
  }

  // Nudge/resize the selected note by a grid step from the keyboard. Returns true
  // when the key was consumed so the caret handler below is skipped.
  const nudgeSelected = (event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (!track || !selectedNote) return false
    const step = snapStep
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        if (event.shiftKey) {
          updateNote(track.id, selectedNote.id, {
            duration: Math.max(step, selectedNote.duration - step),
          })
        } else {
          updateNote(track.id, selectedNote.id, {
            start: Math.max(0, selectedNote.start - step),
          })
        }
        return true
      case 'ArrowRight':
        event.preventDefault()
        if (event.shiftKey) {
          updateNote(track.id, selectedNote.id, {
            duration: selectedNote.duration + step,
          })
        } else {
          updateNote(track.id, selectedNote.id, { start: selectedNote.start + step })
        }
        return true
      case 'ArrowUp': {
        event.preventDefault()
        const pitch = clampPitch(selectedNote.pitch + 1)
        updateNote(track.id, selectedNote.id, { pitch })
        previewNote(pitch)
        return true
      }
      case 'ArrowDown': {
        event.preventDefault()
        const pitch = clampPitch(selectedNote.pitch - 1)
        updateNote(track.id, selectedNote.id, { pitch })
        previewNote(pitch)
        return true
      }
      case 'Escape':
        event.preventDefault()
        selectNote(null)
        return true
      default:
        return false
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!track) return

    // Zoom shortcuts (work whether or not a note is selected).
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      if (event.shiftKey) zoomPitch(ZOOM_STEP)
      else zoomTime(ZOOM_STEP)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      if (event.shiftKey) zoomPitch(1 / ZOOM_STEP)
      else zoomTime(1 / ZOOM_STEP)
      return
    }

    // A selected note captures the arrows for precise move/resize.
    if (selectedNote && nudgeSelected(event)) return

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        setCaret((c) => ({ ...c, pitch: clampToWindow(c.pitch + 1) }))
        break
      case 'ArrowDown':
        event.preventDefault()
        setCaret((c) => ({ ...c, pitch: clampToWindow(c.pitch - 1) }))
        break
      case 'ArrowRight':
        event.preventDefault()
        setCaret((c) => ({ ...c, beat: c.beat + snapStep }))
        break
      case 'ArrowLeft':
        event.preventDefault()
        setCaret((c) => ({ ...c, beat: Math.max(0, c.beat - snapStep) }))
        break
      case 'Enter':
        event.preventDefault()
        addNoteAt(track.id, caret.pitch, caret.beat, Math.max(snapStep, 1))
        previewNote(caret.pitch)
        break
      case 'Delete':
      case 'Backspace':
        if (selectedNoteId) {
          event.preventDefault()
          removeNote(track.id, selectedNoteId)
        }
        break
      default:
        break
    }
  }

  const handleVelocityKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    noteId: string,
    velocity: number,
  ): void => {
    if (!track) return
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      updateNote(track.id, noteId, { velocity: round2(clamp01(velocity + 0.05)) })
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      updateNote(track.id, noteId, { velocity: round2(clamp01(velocity - 0.05)) })
    }
  }

  const noteLabel = (pitch: number, start: number): string => {
    const name = (isDrum && drumLabel(pitch)) || pitchToName(pitch)
    return `${name} at beat ${start}`
  }

  const gridStyle = {
    minWidth: width,
    height,
    '--beat-w': `${layout.beatWidth}px`,
    '--row-h': `${layout.rowHeight}px`,
    '--bar-w': `${layout.beatWidth * 4}px`,
  } as CSSProperties

  const playing = transportState !== 'stopped'
  const quantizeLabel =
    selectedNoteIds.length > 0 ? 'Quantize selection' : 'Quantize all'

  return (
    <section className="piano-roll" aria-label="Piano roll editor">
      <div className="pr-toolbar" role="toolbar" aria-label="Piano roll editing controls">
        <div className="pr-tool-group" role="group" aria-label="Zoom">
          <span className="pr-tool-label" aria-hidden="true">
            Zoom
          </span>
          <div className="pr-btn-cluster">
            <button
              type="button"
              className="btn btn-sm"
              data-interaction="studio.piano-roll.zoom.time-out"
              onClick={() => zoomTime(1 / ZOOM_STEP)}
              aria-label="Zoom out horizontally (time)"
              title="Zoom out — time (−)"
            >
              −
            </button>
            <span className="pr-tool-sub" aria-hidden="true">
              Time
            </span>
            <button
              type="button"
              className="btn btn-sm"
              data-interaction="studio.piano-roll.zoom.time-in"
              onClick={() => zoomTime(ZOOM_STEP)}
              aria-label="Zoom in horizontally (time)"
              title="Zoom in — time (+)"
            >
              +
            </button>
          </div>
          <div className="pr-btn-cluster">
            <button
              type="button"
              className="btn btn-sm"
              data-interaction="studio.piano-roll.zoom.pitch-out"
              onClick={() => zoomPitch(1 / ZOOM_STEP)}
              aria-label="Zoom out vertically (pitch)"
              title="Zoom out — pitch (Shift −)"
            >
              −
            </button>
            <span className="pr-tool-sub" aria-hidden="true">
              Pitch
            </span>
            <button
              type="button"
              className="btn btn-sm"
              data-interaction="studio.piano-roll.zoom.pitch-in"
              onClick={() => zoomPitch(ZOOM_STEP)}
              aria-label="Zoom in vertically (pitch)"
              title="Zoom in — pitch (Shift +)"
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.piano-roll.zoom.reset"
            onClick={resetZoom}
            aria-label="Reset zoom"
            title="Reset zoom"
          >
            Reset
          </button>
          <output className="pr-zoom-readout" aria-label="Current zoom">
            {Math.round(zoomX * 100)}% × {Math.round(zoomY * 100)}%
          </output>
        </div>

        <div className="pr-tool-group" role="group" aria-label="Quantize">
          <span className="pr-tool-label" aria-hidden="true">
            Quantize
          </span>
          <label className="field pr-quantize-strength">
            <span className="pr-tool-sub">Strength</span>
            <input
              type="range"
              data-interaction="studio.piano-roll.quantize.strength"
              min={0}
              max={1}
              step={0.05}
              value={quantizeStrength}
              onChange={(event) => setQuantizeStrength(Number(event.target.value))}
              aria-label="Quantize strength"
            />
            <span className="field-suffix">{Math.round(quantizeStrength * 100)}%</span>
          </label>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.piano-roll.quantize.apply"
            onClick={runQuantize}
            disabled={!track || track.notes.length === 0}
            aria-label={`${quantizeLabel} to the current snap grid`}
          >
            {quantizeLabel}
          </button>
        </div>

        <div className="pr-tool-group" role="group" aria-label="Velocity">
          <button
            type="button"
            className={`btn btn-sm${showVelocity ? ' is-active' : ''}`}
            data-interaction="studio.piano-roll.velocity.toggle"
            onClick={() => setShowVelocity((v) => !v)}
            aria-pressed={showVelocity}
            aria-label="Toggle velocity lane"
          >
            Velocity lane
          </button>
        </div>
      </div>

      {isMultiTrack && (
        <ul className="pr-legend" aria-label="Tracks shown on the piano roll">
          {visibleTracks.map((t) => {
            const isActive = t.id === activeTrackId
            return (
              <li
                key={t.id}
                className={`pr-legend-item${isActive ? ' is-active' : ''}`}
              >
                <span
                  className="pr-legend-swatch"
                  style={{ background: t.color }}
                  aria-hidden="true"
                />
                <span className="pr-legend-name">{t.name}</span>
                <span className="pr-legend-role">
                  {isActive ? '(editing)' : '(read-only)'}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="pr-scroll" ref={scrollRef} onScroll={syncVelocityScroll}>
        <div className="pr-keys" aria-hidden="true" style={{ height }}>
          {Array.from({ length: visibleRows }, (_, row) => {
            const pitch = topPitch - row
            return (
              <div
                key={pitch}
                className={`pr-key${isBlackKey(pitch) ? ' is-black' : ''}`}
                style={{ height: layout.rowHeight }}
              >
                {pitch % 12 === 0 ? pitchToName(pitch) : ''}
              </div>
            )
          })}
        </div>

        <div
          ref={gridRef}
          className="pr-grid"
          data-interaction="studio.piano-roll.grid"
          role="application"
          aria-label="Note grid. Use arrow keys to move the caret, Enter to add a note, Delete to remove the selected note. With a note selected, arrow keys nudge it and Shift+Left/Right resize it. Press + or - to zoom."
          tabIndex={0}
          style={gridStyle}
          onKeyDown={handleKeyDown}
          onPointerDown={startEmptyTouch}
          onPointerMove={moveEmptyTouch}
          onPointerUp={endEmptyTouch}
          onPointerCancel={cancelEmptyTouch}
        >
          <div
            className="pr-caret"
            aria-hidden="true"
            style={{
              left: beatToX(caret.beat, layout),
              top: rowOfPitch(caret.pitch) * layout.rowHeight,
              width: snapStep * layout.beatWidth,
              height: layout.rowHeight,
            }}
          />

          {/* Read-only context from other visible tracks (#131). Rendered before
              the active notes so the editable track always paints on top, and as
              non-interactive, aria-hidden divs (no gesture handlers, pointer-events
              disabled in CSS) so drags only ever hit the active track. */}
          {ghostTracks.map((ghost) =>
            ghost.notes.map((note) => {
              const rect = noteRect(note, layout)
              return (
                <div
                  key={`ghost-${ghost.id}-${note.id}`}
                  className="pr-note is-ghost"
                  aria-hidden="true"
                  style={{
                    left: rect.left,
                    top: rowOfPitch(note.pitch) * layout.rowHeight,
                    width: rect.width,
                    height: rect.height,
                    background: ghost.color,
                    opacity: 0.25 + 0.25 * note.velocity,
                  }}
                />
              )
            }),
          )}

          {track?.notes.map((note) => {
            const rect = noteRect(note, layout)
            const selected = selectedSet.has(note.id)
            return (
              <button
                key={note.id}
                type="button"
                className={`pr-note${selected ? ' is-selected' : ''}`}
                data-interaction="studio.piano-roll.note"
                style={{
                  left: rect.left,
                  top: rowOfPitch(note.pitch) * layout.rowHeight,
                  width: rect.width,
                  height: rect.height,
                  background: track.color,
                  opacity: 0.4 + 0.6 * note.velocity,
                }}
                aria-label={noteLabel(note.pitch, note.start)}
                aria-pressed={selected}
                onPointerDown={(event) => startMove(event, note.id)}
                onClick={() => selectNote(note.id)}
              >
                <span
                  className="pr-note-resize pr-note-resize-start"
                  data-interaction="studio.piano-roll.note.resize-start"
                  aria-hidden="true"
                  onPointerDown={(event) => startResize(event, note.id, 'start')}
                />
                <span
                  className="pr-note-resize pr-note-resize-end"
                  data-interaction="studio.piano-roll.note.resize-end"
                  aria-hidden="true"
                  onPointerDown={(event) => startResize(event, note.id, 'end')}
                />
              </button>
            )
          })}

          {previewNotes.map((note, index) => {
            const rect = noteRect(note, layout)
            return (
              <div
                key={`preview-${index}`}
                className="pr-note is-preview"
                aria-hidden="true"
                style={{
                  left: rect.left,
                  top: rowOfPitch(note.pitch) * layout.rowHeight,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            )
          })}

          {playing && (
            <div
              className="pr-playhead"
              aria-hidden="true"
              style={{ left: beatToX(positionBeats, layout) }}
            />
          )}
        </div>
      </div>

      {showVelocity && (
        <div className="pr-velocity" ref={velScrollRef} role="group" aria-label="Velocity lane">
          <div className="pr-velocity-gutter" aria-hidden="true">
            Vel
          </div>
          <div className="pr-velocity-track" ref={velLaneRef} style={{ minWidth: width }}>
            {track?.notes.map((note) => {
              const selected = selectedSet.has(note.id)
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`pr-vel-bar${selected ? ' is-selected' : ''}`}
                  data-interaction="studio.piano-roll.velocity.note"
                  style={{
                    left: beatToX(note.start, layout),
                    width: Math.max(4, layout.beatWidth * 0.35),
                    height: `${note.velocity * 100}%`,
                    background: track.color,
                  }}
                  aria-label={`Velocity for ${noteLabel(note.pitch, note.start)}: ${Math.round(
                    note.velocity * 127,
                  )}`}
                  onPointerDown={(event) => startVelocity(event, note.id)}
                  onKeyDown={(event) => handleVelocityKey(event, note.id, note.velocity)}
                />
              )
            })}
          </div>
        </div>
      )}

      <div className="pr-footer">
        {selectedNote ? (
          <label className="field">
            <span>Velocity</span>
            <input
              type="range"
              data-interaction="studio.piano-roll.velocity.selected"
              min={0}
              max={1}
              step={0.05}
              value={selectedNote.velocity}
              onChange={(event) =>
                track &&
                updateNote(track.id, selectedNote.id, {
                  velocity: Number(event.target.value),
                })
              }
            />
            <span className="field-suffix">{Math.round(selectedNote.velocity * 127)}</span>
          </label>
        ) : (
          <p className="pr-hint">
            Click the grid to add a note, or focus it and press Enter. Drag to move, drag either
            edge to resize. Select a note and use arrow keys for precise nudges.
          </p>
        )}
      </div>
    </section>
  )
}
