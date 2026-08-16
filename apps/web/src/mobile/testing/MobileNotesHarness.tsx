import {
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  MAX_PITCH,
  MIN_PITCH,
  type Note,
} from '../../composer/model/project'
import { ContextualCoachMark } from '../ContextualCoachMark'
import { FullScreenSheet } from '../FullScreenSheet'
import { MobileHelpSheet } from '../MobileHelpSheet'
import { MobileNoteControls } from '../MobileNoteControls'
import { MobileTaskNavigator } from '../MobileTaskNavigator'
import { SelectedNoteEditorSheet } from '../SelectedNoteEditorSheet'
import { COACH_MARKS } from '../coachMarks'
import {
  beginEmptyGesture,
  beginNoteGesture,
  cancelNoteGesture,
  endNoteGesture,
  idleNoteGesture,
  moveNoteGesture,
  type GesturePointer,
  type NoteGestureEffect,
  type NoteGestureState,
} from '../noteGestureMachine'
import {
  initialMobileTaskState,
  mobileTaskReducer,
  type MobileTaskId,
} from '../mobileTaskModel'

const CELL_WIDTH = 48
const ROW_HEIGHT = 32

const initialNotes: Note[] = [
  { id: 'note-1', pitch: 60, start: 2, duration: 1, velocity: 0.8 },
]

function pointerFromEvent(event: PointerEvent, coordinateTarget: Element): GesturePointer {
  const rect = coordinateTarget.getBoundingClientRect()
  return {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    point: {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    },
  }
}

export function MobileNotesHarness() {
  const [mobile, dispatch] = useReducer(mobileTaskReducer, initialMobileTaskState)
  const [notes, setNotes] = useState(initialNotes)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [aiSuggestion, setAiSuggestion] = useState(false)
  const [coachVisible, setCoachVisible] = useState(true)
  const [panCount, setPanCount] = useState(0)
  const [capturedPointerId, setCapturedPointerId] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const capturedTargetRef = useRef<HTMLElement | null>(null)
  const gestureRef = useRef<NoteGestureState>(idleNoteGesture)
  const noteBeforeMoveRef = useRef<Note | null>(null)
  const nextNoteNumberRef = useRef(2)

  const selectedNote =
    notes.find((note) => note.id === mobile.selectedNoteId) ?? null

  const applyEffects = (effects: readonly NoteGestureEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'capture-pointer':
          if (
            capturedTargetRef.current &&
            !capturedTargetRef.current.hasPointerCapture(effect.pointerId)
          ) {
            capturedTargetRef.current.setPointerCapture(effect.pointerId)
          }
          setCapturedPointerId(effect.pointerId)
          break
        case 'release-pointer':
          if (capturedTargetRef.current?.hasPointerCapture(effect.pointerId)) {
            capturedTargetRef.current.releasePointerCapture(effect.pointerId)
          }
          capturedTargetRef.current = null
          setCapturedPointerId(null)
          noteBeforeMoveRef.current = null
          break
        case 'pan-by':
          setPanCount((count) => count + 1)
          break
        case 'add-note':
          setNotes((current) => [
            ...current,
            {
              id: `note-${nextNoteNumberRef.current++}`,
              pitch: 66 - Math.floor(effect.point.y / ROW_HEIGHT),
              start: Math.max(0, effect.point.x / CELL_WIDTH),
              duration: 1,
              velocity: 0.8,
            },
          ])
          break
        case 'select-note':
          dispatch({ type: 'select-note', noteId: effect.noteId })
          break
        case 'move-note': {
          const original = noteBeforeMoveRef.current
          if (!original || original.id !== effect.noteId) break
          setNotes((current) =>
            current.map((note) =>
              note.id === effect.noteId
                ? {
                    ...note,
                    start: Math.max(0, original.start + effect.dx / CELL_WIDTH),
                    pitch: Math.min(
                      108,
                      Math.max(21, original.pitch - Math.round(effect.dy / ROW_HEIGHT)),
                    ),
                  }
                : note,
            ),
          )
          break
        }
        case 'cancel-note-move': {
          const original = noteBeforeMoveRef.current
          if (!original || original.id !== effect.noteId) break
          setNotes((current) =>
            current.map((note) => (note.id === original.id ? original : note)),
          )
          break
        }
      }
    }
  }

  const startEmpty = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || gestureRef.current.kind !== 'idle') {
      return
    }
    const transition = beginEmptyGesture(
      pointerFromEvent(event, event.currentTarget),
      mobile.noteMode,
    )
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const startNote = (event: PointerEvent<HTMLButtonElement>, note: Note) => {
    event.stopPropagation()
    if (!gridRef.current || gestureRef.current.kind !== 'idle') return
    capturedTargetRef.current = event.currentTarget
    noteBeforeMoveRef.current = note
    const transition = beginNoteGesture(
      pointerFromEvent(event, gridRef.current),
      note.id,
    )
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const transition = moveNoteGesture(
      gestureRef.current,
      pointerFromEvent(event, event.currentTarget),
    )
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    const transition = endNoteGesture(
      gestureRef.current,
      pointerFromEvent(event, event.currentTarget),
    )
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const cancelPointer = (event: PointerEvent<HTMLDivElement>) => {
    const transition = cancelNoteGesture(gestureRef.current, event.pointerId)
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const losePointerCapture = (event: PointerEvent<HTMLButtonElement>) => {
    if (
      gestureRef.current.kind === 'idle' ||
      gestureRef.current.pointerId !== event.pointerId
    ) {
      return
    }
    const transition = cancelNoteGesture(gestureRef.current, event.pointerId)
    gestureRef.current = transition.state
    applyEffects(transition.effects)
  }

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      setNotes((current) => [
        ...current,
        {
          id: `note-${nextNoteNumberRef.current++}`,
          pitch: 60,
          start: 0,
          duration: 1,
          velocity: 0.8,
        },
      ])
      return
    }
    if (!selectedNote) return

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      setNotes((current) => current.filter((note) => note.id !== selectedNote.id))
      dispatch({ type: 'clear-note-selection' })
      return
    }
    if (event.shiftKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      const amount = event.key === 'ArrowRight' ? 0.25 : -0.25
      updateSelected({ duration: Math.max(0.0625, selectedNote.duration + amount) })
      return
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const changes: Partial<Note> =
        event.key === 'ArrowRight'
          ? { start: selectedNote.start + 0.25 }
          : event.key === 'ArrowLeft'
            ? { start: Math.max(0, selectedNote.start - 0.25) }
            : event.key === 'ArrowUp'
              ? { pitch: Math.min(MAX_PITCH, selectedNote.pitch + 1) }
              : { pitch: Math.max(MIN_PITCH, selectedNote.pitch - 1) }
      updateSelected(changes)
    }
  }

  const updateSelected = (changes: Partial<Note>) => {
    if (!selectedNote) return
    setNotes((current) =>
      current.map((note) =>
        note.id === selectedNote.id ? { ...note, ...changes } : note,
      ),
    )
  }

  const openTask = (task: MobileTaskId) => {
    if (task === 'notes') {
      dispatch({ type: 'open-task', task: 'notes' })
      dispatch({ type: 'close-sheet' })
      return
    }
    dispatch({ type: 'open-task', task })
  }

  return (
    <div
      className="mobile-harness"
      data-captured-pointer={capturedPointerId ?? undefined}
    >
      <header className="mobile-harness__transport" aria-label="Transport controls">
        <button type="button" onClick={() => setPlaying((value) => !value)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          aria-pressed={loop}
          onClick={() => setLoop((value) => !value)}
        >
          Loop
        </button>
        <label>
          Tempo
          <input type="number" defaultValue={120} min={20} max={300} />
        </label>
        <label>
          Snap
          <select defaultValue="0.25">
            <option value="0.25">1/16</option>
            <option value="0.5">1/8</option>
            <option value="1">1/4</option>
          </select>
        </label>
      </header>

      <main>
        {coachVisible && (
          <ContextualCoachMark
            mark={COACH_MARKS.find((mark) => mark.id === 'note-modes') ?? null}
            onDismiss={() => setCoachVisible(false)}
          />
        )}
        <MobileNoteControls
          mode={mobile.noteMode}
          hasSelection={selectedNote !== null}
          onModeChange={(mode) => dispatch({ type: 'set-note-mode', mode })}
          onEditSelection={() => {
            if (selectedNote) {
              dispatch({ type: 'open-selected-note' })
            }
          }}
        />
        <p className="mobile-harness__status" aria-live="polite">
          {notes.length} notes, {panCount} pan moves
        </p>
        <div
          className="mobile-piano-scroll mobile-harness__piano-scroll"
          data-testid="piano-scroll"
        >
          <div
            ref={gridRef}
            className="mobile-harness__grid"
            data-testid="note-grid"
            role="application"
            aria-label="Mobile note grid"
            tabIndex={0}
            onKeyDown={handleKeyboard}
            onPointerDown={startEmpty}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={cancelPointer}
          >
            {notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="mobile-note-manipulation mobile-harness__note"
                data-note-id={note.id}
                data-start={note.start}
                data-pitch={note.pitch}
                data-duration={note.duration}
                data-velocity={note.velocity}
                aria-label={`Note ${note.id}`}
                aria-pressed={selectedNote?.id === note.id}
                style={{
                  left: note.start * CELL_WIDTH,
                  top: (66 - note.pitch) * ROW_HEIGHT,
                  width: Math.max(44, note.duration * CELL_WIDTH),
                }}
                onPointerDown={(event) => startNote(event, note)}
                onLostPointerCapture={losePointerCapture}
                onClick={() => dispatch({ type: 'select-note', noteId: note.id })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.stopPropagation()
                  }
                }}
              />
            ))}
          </div>
        </div>
      </main>

      <MobileTaskNavigator
        state={mobile}
        onOpenTask={openTask}
        onOpenHelp={() => dispatch({ type: 'open-help' })}
      />

      <FullScreenSheet
        open={mobile.openSheet === 'project'}
        title="Project"
        onClose={() => dispatch({ type: 'close-sheet' })}
      >
        <div className="mobile-harness__actions">
          {['Create', 'Open', 'Import', 'Save', 'Share', 'Export'].map((action) => (
            <button type="button" key={action}>{action}</button>
          ))}
        </div>
      </FullScreenSheet>

      <FullScreenSheet
        open={mobile.openSheet === 'tracks'}
        title="Tracks"
        onClose={() => dispatch({ type: 'close-sheet' })}
      >
        <label className="mobile-harness__field">
          Instrument
          <select defaultValue="Piano">
            <option>Piano</option>
            <option>Synth</option>
            <option>Drums</option>
          </select>
        </label>
      </FullScreenSheet>

      <FullScreenSheet
        open={mobile.openSheet === 'tools'}
        title="Tools"
        onClose={() => dispatch({ type: 'close-sheet' })}
      >
        <button type="button" onClick={() => setAiSuggestion(true)}>
          Generate AI idea
        </button>
        {aiSuggestion && (
          <div className="mobile-harness__actions" aria-label="AI suggestion">
            <button type="button" onClick={() => setAiSuggestion(false)}>Accept</button>
            <button type="button" onClick={() => setAiSuggestion(false)}>Discard</button>
          </div>
        )}
      </FullScreenSheet>

      <SelectedNoteEditorSheet
        open={mobile.openSheet === 'selected-note'}
        note={selectedNote}
        onClose={() => dispatch({ type: 'close-sheet' })}
        onChange={updateSelected}
        onDelete={() => {
          if (!selectedNote) return
          setNotes((current) => current.filter((note) => note.id !== selectedNote.id))
          dispatch({ type: 'clear-note-selection' })
        }}
      />

      <MobileHelpSheet
        open={mobile.openSheet === 'help'}
        onClose={() => dispatch({ type: 'close-sheet' })}
      />
    </div>
  )
}
