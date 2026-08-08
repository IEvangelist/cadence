import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { MAX_PITCH, MIN_PITCH, isBlackKey, pitchToName } from '../model/project'
import { getInstrument, drumLabel } from '../instruments/registry'
import { type ComposerController } from '../hooks/useComposer'
import {
  DEFAULT_LAYOUT,
  PITCH_ROWS,
  beatToX,
  noteRect,
  pitchToRow,
  snap as snapBeat,
  snapFloor,
  xToBeat,
  yToPitch,
} from '../timing/timing'

interface PianoRollProps {
  controller: ComposerController
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

/**
 * DOM-based piano roll — chosen over canvas so notes are real focusable
 * elements and the whole editor is keyboard-accessible and axe-clean. All
 * geometry comes from the pure timing helpers.
 */
export function PianoRoll({ controller }: PianoRollProps) {
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
  } = controller

  const track =
    project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const isDrum = track ? getInstrument(track.instrumentId).kind === 'drum' : false
  const selectedNoteId = state.selectedNoteIds[0] ?? null
  const selectedNote = track?.notes.find((n) => n.id === selectedNoteId)

  const gridRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [caret, setCaret] = useState({ pitch: 60, beat: 0 })

  const snapStep = snap > 0 ? snap : 1
  const width = project.lengthBeats * layout.beatWidth
  const height = PITCH_ROWS * layout.rowHeight

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
    const pitch = yToPitch(event.clientY - rect.top, layout)
    setCaret({ pitch, beat })
    addNoteAt(track.id, pitch, beat, snapStep)
    previewNote(pitch)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!track) return
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        setCaret((c) => ({ ...c, pitch: clampPitch(c.pitch + 1) }))
        break
      case 'ArrowDown':
        event.preventDefault()
        setCaret((c) => ({ ...c, pitch: clampPitch(c.pitch - 1) }))
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
        addNoteAt(track.id, caret.pitch, caret.beat, snapStep)
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
    width,
    height,
    '--beat-w': `${layout.beatWidth}px`,
    '--row-h': `${layout.rowHeight}px`,
    '--bar-w': `${layout.beatWidth * 4}px`,
  } as CSSProperties

  const playing = transportState !== 'stopped'

  return (
    <section className="piano-roll" aria-label="Piano roll editor">
      <div className="pr-scroll">
        <div className="pr-keys" aria-hidden="true" style={{ height }}>
          {Array.from({ length: PITCH_ROWS }, (_, row) => {
            const pitch = MAX_PITCH - row
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
              top: pitchToRow(caret.pitch) * layout.rowHeight,
              width: snapStep * layout.beatWidth,
              height: layout.rowHeight,
            }}
          />

          {track?.notes.map((note) => {
            const rect = noteRect(note, layout)
            const selected = note.id === selectedNoteId
            return (
              <button
                key={note.id}
                type="button"
                className={`pr-note${selected ? ' is-selected' : ''}`}
                style={{
                  left: rect.left,
                  top: rect.top,
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
