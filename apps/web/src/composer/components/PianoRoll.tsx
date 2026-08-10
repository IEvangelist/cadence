import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { MAX_PITCH, MIN_PITCH, isBlackKey, pitchToName } from '../model/project'
import { getInstrument, drumLabel } from '../instruments/registry'
import { type ComposerController } from '../hooks/useComposer'
import type { SuggestedNote } from '../ai/types'
import {
  DEFAULT_LAYOUT,
  beatToX,
  noteRect,
  snap as snapBeat,
  snapFloor,
  xToBeat,
} from '../timing/timing'

interface PianoRollProps {
  controller: ComposerController
  /** Ghost notes from a pending AI suggestion, rendered visually distinct. */
  previewNotes?: SuggestedNote[]
}

interface Gesture {
  mode: 'move' | 'resize'
  noteId: string
  startX: number
  startY: number
  origStart: number
  origPitch: number
  origDuration: number
}

const layout = DEFAULT_LAYOUT
const clampPitch = (p: number): number => Math.min(MAX_PITCH, Math.max(MIN_PITCH, p))
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
export function PianoRoll({ controller, previewNotes = [] }: PianoRollProps) {
  const {
    project,
    selectedTrackId,
    state,
    snap,
    addNoteAt,
    updateNote,
    removeNote,
    selectNote,
    previewNote,
    positionBeats,
    transportState,
    revealRequest,
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

  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const didAutoScrollRef = useRef(false)
  const gestureRef = useRef<Gesture | null>(null)
  const [caret, setCaret] = useState({ pitch: 60, beat: 0 })
  const [viewportRows, setViewportRows] = useState(0)

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
  const notePitches = track?.notes.map((n) => n.pitch) ?? []
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
  const latest = useRef({ track, snap: snapStep, updateNote })
  useEffect(() => {
    latest.current = { track, snap: snapStep, updateNote }
  })

  useEffect(() => {
    const handleMove = (event: globalThis.PointerEvent) => {
      const gesture = gestureRef.current
      const { track: t, snap: step, updateNote: update } = latest.current
      if (!gesture || !t) return
      const dBeat = (event.clientX - gesture.startX) / layout.beatWidth
      if (gesture.mode === 'move') {
        // Ignore sub-threshold pointer travel so a click-to-select doesn't nudge.
        if (
          Math.abs(event.clientX - gesture.startX) < 3 &&
          Math.abs(event.clientY - gesture.startY) < 3
        )
          return
        const dRows = Math.round((event.clientY - gesture.startY) / layout.rowHeight)
        update(t.id, gesture.noteId, {
          start: snapBeat(gesture.origStart + dBeat, step),
          pitch: clampPitch(gesture.origPitch - dRows),
        })
      } else {
        update(t.id, gesture.noteId, {
          duration: Math.max(step, snapBeat(gesture.origDuration + dBeat, step)),
        })
      }
    }
    const handleUp = () => {
      gestureRef.current = null
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
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
  }, [])

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
    scroller.scrollLeft = Math.max(0, beatToX(minStart) - layout.beatWidth)

    const pitches = inserted.map((note) => note.pitch)
    const centerPitch = Math.round((Math.max(...pitches) + Math.min(...pitches)) / 2)
    const centerY = (topPitch - centerPitch) * layout.rowHeight + layout.rowHeight / 2
    scroller.scrollTop = Math.max(0, centerY - scroller.clientHeight / 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on token bump only, not on every note edit
  }, [revealRequest.token])

  const beginGesture = (gesture: Gesture): void => {
    gestureRef.current = gesture
  }

  const startMove = (event: PointerEvent, noteId: string): void => {
    if (!track) return
    event.stopPropagation()
    const note = track.notes.find((n) => n.id === noteId)
    if (!note) return
    selectNote(noteId)
    beginGesture({
      mode: 'move',
      noteId,
      startX: event.clientX,
      startY: event.clientY,
      origStart: note.start,
      origPitch: note.pitch,
      origDuration: note.duration,
    })
  }

  const startResize = (event: PointerEvent, noteId: string): void => {
    if (!track) return
    event.stopPropagation()
    const note = track.notes.find((n) => n.id === noteId)
    if (!note) return
    beginGesture({
      mode: 'resize',
      noteId,
      startX: event.clientX,
      startY: event.clientY,
      origStart: note.start,
      origPitch: note.pitch,
      origDuration: note.duration,
    })
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!track) return
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
      case ' ':
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

  return (
    <section className="piano-roll" aria-label="Piano roll editor">
      <div className="pr-scroll" ref={scrollRef}>
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
          role="application"
          aria-label="Note grid. Use arrow keys to move the caret, Enter to add a note, Delete to remove the selected note."
          tabIndex={0}
          style={gridStyle}
          onKeyDown={handleKeyDown}
          onPointerDown={addAtPoint}
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

          {track?.notes.map((note) => {
            const rect = noteRect(note, layout)
            const selected = selectedSet.has(note.id)
            return (
              <button
                key={note.id}
                type="button"
                className={`pr-note${selected ? ' is-selected' : ''}`}
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
                  className="pr-note-resize"
                  aria-hidden="true"
                  onPointerDown={(event) => startResize(event, note.id)}
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

      <div className="pr-footer">
        {selectedNote ? (
          <label className="field">
            <span>Velocity</span>
            <input
              type="range"
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
            Click the grid to add a note, or focus it and press Enter. Drag to move, drag the
            right edge to resize.
          </p>
        )}
      </div>
    </section>
  )
}
