import { useEffect } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PianoRoll } from './PianoRoll'
import { TrackPanel } from './TrackPanel'
import { type ComposerController, useComposer } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote, createTrack, type Project } from '../model/project'

function seededProject(): Project {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      { name: 'Lead', color: '#7a2ff0', notes: [createNote({ pitch: 72, start: 0, duration: 1 }, 'n_lead')] },
      'track_lead',
    ),
    createTrack(
      { name: 'Bass', color: '#2563eb', notes: [createNote({ pitch: 36, start: 2, duration: 1 }, 'n_bass')] },
      'track_bass',
    ),
  ]
  return project
}

/** Renders the track panel + roll on one controller, capturing it for assertions. */
function Harness({ onController }: { onController?: (c: ComposerController) => void }) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: seededProject(),
    autosaveDelay: 0,
  })
  useEffect(() => {
    onController?.(controller)
  })
  return (
    <>
      <TrackPanel controller={controller} />
      <PianoRoll controller={controller} />
    </>
  )
}

const ghostNotes = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('.pr-note.is-ghost'))
const interactiveNotes = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('button.pr-note'))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<PianoRoll /> multi-track view (#131)', () => {
  it('shows only the selected track until other tracks are toggled on', () => {
    render(<Harness />)

    // Default: just the selected (Lead) track renders, as an interactive note.
    expect(interactiveNotes()).toHaveLength(1)
    expect(ghostNotes()).toHaveLength(0)
    // No legend for a single visible track.
    expect(screen.queryByRole('list', { name: /Tracks shown on the piano roll/ })).toBeNull()
  })

  it('overlays every visible track, keeping only the selected one interactive', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Show all tracks' }))

    // Both tracks' notes now render: the selected Lead note as an editable
    // button, the Bass note as a read-only ghost.
    const interactive = interactiveNotes()
    const ghosts = ghostNotes()
    expect(interactive).toHaveLength(1)
    expect(ghosts).toHaveLength(1)
    // Two notes total across the two visible tracks.
    expect(document.querySelectorAll('.pr-note')).toHaveLength(2)

    // The ghost is a non-interactive, aria-hidden element painted in its own
    // track colour — never a focusable button.
    const ghost = ghosts[0]
    expect(ghost.tagName).toBe('DIV')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost).not.toHaveAttribute('aria-pressed')

    // The editable note is the selected Lead track's note.
    expect(interactive[0].getAttribute('aria-label')).toMatch(/C5 at beat 0/)
  })

  it('renders a legend mapping each visible track colour to its name and role', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Show all tracks' }))

    const legend = screen.getByRole('list', { name: /Tracks shown on the piano roll/ })
    // Colour is paired with the track NAME (a11y: colour is never the sole cue).
    expect(within(legend).getByText('Lead')).toBeInTheDocument()
    expect(within(legend).getByText('Bass')).toBeInTheDocument()
    // The selected track is labelled editable; the other read-only.
    expect(within(legend).getByText('(editing)')).toBeInTheDocument()
    expect(within(legend).getByText('(read-only)')).toBeInTheDocument()
  })

  it('does NOT mutate a ghost track when an edit gesture happens over it', () => {
    let controller: ComposerController | null = null
    render(<Harness onController={(c) => (controller = c)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show all tracks' }))

    const bassBefore = JSON.stringify(
      controller!.project.tracks.find((t) => t.id === 'track_bass')?.notes,
    )

    // Attempt a full drag gesture starting on the Bass ghost note. It carries no
    // gesture handlers and is pointer-events:none, so it can't be grabbed.
    const ghost = ghostNotes()[0]
    fireEvent.pointerDown(ghost, { clientX: 120, clientY: 40 })
    fireEvent.pointerMove(window, { clientX: 320, clientY: 220 })
    fireEvent.pointerUp(window)

    const bassAfter = JSON.stringify(
      controller!.project.tracks.find((t) => t.id === 'track_bass')?.notes,
    )
    expect(bassAfter).toBe(bassBefore)
    // The gesture never selected the ghost note either.
    expect(controller!.state.selectedNoteIds).not.toContain('n_bass')
  })
})
