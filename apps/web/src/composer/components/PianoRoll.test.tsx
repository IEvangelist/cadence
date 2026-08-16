import { useEffect } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { PianoRoll } from './PianoRoll'
import { useComposer } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote } from '../model/project'
import { DEFAULT_LAYOUT } from '../timing/timing'

function Harness() {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  })
  return <PianoRoll controller={controller} />
}

function HistoryHarness() {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  })
  const track = controller.project.tracks[0]
  const note = track.notes[0]
  return (
    <>
      <PianoRoll controller={controller} />
      <button type="button" onClick={controller.undo} disabled={!controller.canUndo}>
        Undo history
      </button>
      <button type="button" onClick={controller.redo} disabled={!controller.canRedo}>
        Redo history
      </button>
      <output aria-label="Note state">
        {note ? `${note.start}:${note.pitch}:${note.velocity}` : 'none'}
      </output>
    </>
  )
}

// The grid reads clientX/Y relative to its bounding box; jsdom returns zeros, so
// pin the box to the origin and drive pointer coordinates directly.
function mockGridRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<PianoRoll />', () => {
  it('adds a note by keyboard (focus grid, move caret, Enter)', () => {
    render(<Harness />)
    const grid = screen.getByRole('application')
    grid.focus()
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowUp' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('pr-note'))).toHaveLength(1)
  })

  it('does not add a note with Space so the Studio dispatcher can control transport', () => {
    render(<Harness />)
    const grid = screen.getByRole('application')
    grid.focus()
    fireEvent.keyDown(grid, { key: ' ' })
    expect(screen.queryAllByRole('button').filter((button) =>
      button.className.includes('pr-note'),
    )).toHaveLength(0)
  })

  it('adds a note by clicking the grid and can delete it with the keyboard', () => {
    coversInteractions('studio.piano-roll.grid')
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 96, clientY: 80 })
    const notes = () =>
      screen.queryAllByRole('button').filter((b) => b.className.includes('pr-note'))
    expect(notes()).toHaveLength(1)

    // The freshly added note is selected; Delete removes it.
    fireEvent.keyDown(grid, { key: 'Delete' })
    expect(notes()).toHaveLength(0)
  })

  it('edits a note velocity from the velocity lane by keyboard', () => {
    coversInteractions('studio.piano-roll.velocity.note')
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 96, clientY: 80 })
    // The velocity lane exposes one keyboard-operable bar per note.
    const bar = screen.getByRole('button', { name: /Velocity for/ })
    const before = bar.getAttribute('aria-label')
    fireEvent.keyDown(bar, { key: 'ArrowDown' })
    expect(bar.getAttribute('aria-label')).not.toBe(before)
  })

  it('moves a note by dragging it', () => {
    coversInteractions('studio.piano-roll.note')
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeLeft = note.style.left

    fireEvent.pointerDown(note, { clientX: 0, clientY: 80 })
    fireEvent.pointerMove(window, { clientX: DEFAULT_LAYOUT.beatWidth * 2, clientY: 80 })
    fireEvent.pointerUp(window, { clientX: DEFAULT_LAYOUT.beatWidth * 2, clientY: 80 })

    const moved = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(moved.style.left).not.toBe(beforeLeft)
  })

  it('finalizes a drag on pointercancel so later pointer moves cannot mutate it', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((button) =>
      button.className.includes('pr-note'),
    )!

    fireEvent.pointerDown(note, { clientX: 0, clientY: 80 })
    fireEvent.pointerMove(window, {
      clientX: DEFAULT_LAYOUT.beatWidth * 2,
      clientY: 80,
    })
    fireEvent.pointerCancel(window)
    const cancelledLeft = note.style.left

    fireEvent.pointerMove(window, {
      clientX: DEFAULT_LAYOUT.beatWidth * 4,
      clientY: 80,
    })
    expect(note.style.left).toBe(cancelledLeft)
  })

  it('finalizes resize and velocity gestures on pointercancel', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((button) =>
      button.className.includes('pr-note'),
    )!

    const resize = note.querySelector('.pr-note-resize-end') as HTMLElement
    fireEvent.pointerDown(resize, {
      clientX: DEFAULT_LAYOUT.beatWidth,
      clientY: 80,
    })
    fireEvent.pointerMove(window, {
      clientX: DEFAULT_LAYOUT.beatWidth * 3,
      clientY: 80,
    })
    fireEvent.pointerCancel(window)
    const cancelledWidth = note.style.width
    fireEvent.pointerMove(window, {
      clientX: DEFAULT_LAYOUT.beatWidth * 5,
      clientY: 80,
    })
    expect(note.style.width).toBe(cancelledWidth)

    const velocity = screen.getByRole('button', { name: /Velocity for/ })
    fireEvent.pointerDown(velocity, { clientY: 500 })
    fireEvent.pointerMove(window, { clientY: 700 })
    fireEvent.pointerCancel(window)
    const cancelledLabel = velocity.getAttribute('aria-label')
    fireEvent.pointerMove(window, { clientY: 900 })
    expect(velocity.getAttribute('aria-label')).toBe(cancelledLabel)
  })

  it('undoes one complete velocity gesture and separates the next edit', () => {
    mockGridRect()
    render(<HistoryHarness />)
    fireEvent.pointerDown(screen.getByRole('application'), {
      clientX: 0,
      clientY: 80,
    })
    const initialPitch = Number(
      screen.getByRole('status', { name: 'Note state' }).textContent!.split(':')[1],
    )
    const velocity = screen.getByRole('button', { name: /Velocity for/ })

    fireEvent.pointerDown(velocity, { clientY: 400 })
    fireEvent.pointerMove(window, { clientY: 600 })
    fireEvent.pointerUp(window)
    expect(screen.getByRole('status', { name: 'Note state' })).toHaveTextContent(
      `0:${initialPitch}:0.4`,
    )

    const note = screen.getAllByRole('button').find((button) =>
      button.className.includes('pr-note'),
    )!
    fireEvent.keyDown(note, { key: 'ArrowUp' })
    expect(screen.getByRole('status', { name: 'Note state' })).toHaveTextContent(
      `0:${initialPitch + 1}:0.4`,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo history' }))
    expect(screen.getByRole('status', { name: 'Note state' })).toHaveTextContent(
      `0:${initialPitch}:0.4`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo history' }))
    expect(screen.getByRole('status', { name: 'Note state' })).toHaveTextContent(
      `0:${initialPitch}:0.8`,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Redo history' }))
    expect(screen.getByRole('status', { name: 'Note state' })).toHaveTextContent(
      `0:${initialPitch}:0.4`,
    )
  })

  it('resizes a note by dragging its right (end) edge', () => {
    coversInteractions('studio.piano-roll.note.resize-end')
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeWidth = note.style.width
    const handle = note.querySelector('.pr-note-resize-end') as HTMLElement

    fireEvent.pointerDown(handle, { clientX: DEFAULT_LAYOUT.beatWidth, clientY: 80 })
    fireEvent.pointerMove(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })
    fireEvent.pointerUp(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })

    const resized = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(resized.style.width).not.toBe(beforeWidth)
  })

  it('resizes a note from its left (start) edge, holding the end fixed', () => {
    coversInteractions('studio.piano-roll.note.resize-start')
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    // Add a note a few beats in so its start edge has room to move left.
    fireEvent.pointerDown(grid, { clientX: DEFAULT_LAYOUT.beatWidth * 4, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeLeft = note.style.left
    const beforeWidth = note.style.width
    const handle = note.querySelector('.pr-note-resize-start') as HTMLElement

    // Drag the start edge one beat to the left.
    fireEvent.pointerDown(handle, { clientX: DEFAULT_LAYOUT.beatWidth * 4, clientY: 80 })
    fireEvent.pointerMove(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })
    fireEvent.pointerUp(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })

    const resized = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(resized.style.left).not.toBe(beforeLeft)
    expect(resized.style.width).not.toBe(beforeWidth)
  })

  it('nudges the selected note left with the arrow key', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    // Add a note a couple of beats in, leaving room to nudge it left.
    fireEvent.pointerDown(grid, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    fireEvent.click(note)
    const beforeLeft = note.style.left
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    const nudged = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(nudged.style.left).not.toBe(beforeLeft)
  })

  it('zooms the time axis, widening a note', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeWidth = parseFloat(note.style.width)
    fireEvent.click(screen.getByRole('button', { name: /Zoom in horizontally/ }))
    const zoomed = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(parseFloat(zoomed.style.width)).toBeGreaterThan(beforeWidth)
  })

  it('updates and resets zoom, quantize strength, and velocity controls', async () => {
    coversInteractions(
      'studio.piano-roll.zoom.time-out',
      'studio.piano-roll.zoom.time-in',
      'studio.piano-roll.zoom.pitch-out',
      'studio.piano-roll.zoom.pitch-in',
      'studio.piano-roll.zoom.reset',
      'studio.piano-roll.quantize.strength',
      'studio.piano-roll.velocity.toggle',
      'studio.piano-roll.velocity.selected',
    )
    const user = userEvent.setup()
    mockGridRect()
    render(<Harness />)

    const zoom = screen.getByRole('status', { name: 'Current zoom' })
    await user.click(screen.getByRole('button', { name: 'Zoom in horizontally (time)' }))
    expect(zoom).not.toHaveTextContent('100% × 100%')
    await user.click(screen.getByRole('button', { name: 'Zoom out horizontally (time)' }))
    expect(zoom).toHaveTextContent('100% × 100%')

    await user.click(screen.getByRole('button', { name: 'Zoom in vertically (pitch)' }))
    expect(zoom).not.toHaveTextContent('100% × 100%')
    await user.click(screen.getByRole('button', { name: 'Zoom out vertically (pitch)' }))
    expect(zoom).toHaveTextContent('100% × 100%')

    await user.click(screen.getByRole('button', { name: 'Zoom in horizontally (time)' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in vertically (pitch)' }))
    expect(zoom).not.toHaveTextContent('100% × 100%')
    await user.click(screen.getByRole('button', { name: 'Reset zoom' }))
    expect(zoom).toHaveTextContent('100% × 100%')

    fireEvent.change(screen.getByRole('slider', { name: 'Quantize strength' }), {
      target: { value: '0.5' },
    })
    expect(screen.getByText('50%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle velocity lane' }))
    expect(screen.queryByRole('group', { name: 'Velocity lane' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Toggle velocity lane' }))
    expect(screen.getByRole('group', { name: 'Velocity lane' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('application'), { clientX: 96, clientY: 80 })
    const velocityBar = screen.getByRole('button', { name: /Velocity for/ })
    const before = velocityBar.getAttribute('aria-label')
    const selectedVelocity = screen.getByRole('slider', { name: /Velocity/ })
    fireEvent.change(selectedVelocity, {
      target: { value: '0.25' },
    })
    expect(selectedVelocity).toHaveValue('0.25')
    expect(within(selectedVelocity.closest('label')!).getByText('32')).toBeInTheDocument()
    expect(velocityBar.getAttribute('aria-label')).not.toBe(before)
  })

  it('quantizes the selected note to the current snap grid', () => {
    coversInteractions('studio.piano-roll.quantize.apply')
    mockGridRect()
    function QuantizeHarness() {
      const project = createEmptyProject('p')
      project.tracks[0].notes = [
        createNote({ pitch: 60, start: 0.3, duration: 1, velocity: 0.8 }, 'off-grid'),
      ]
      const controller = useComposer({
        createEngine: () => new SilentAudioEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: project,
        autosaveDelay: 0,
      })
      return <PianoRoll controller={controller} />
    }
    render(<QuantizeHarness />)
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeLeft = note.style.left
    fireEvent.click(note)
    fireEvent.click(screen.getByRole('button', { name: /Quantize/ }))
    const quantized = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(quantized.style.left).not.toBe(beforeLeft)
  })

  it('highlights every note in a batch-inserted selection', () => {
    // An accepted AI suggestion inserts several notes and selects them all; the
    // roll must mark each one `.is-selected`, not just the first.
    let controller: ReturnType<typeof useComposer> | undefined
    function Capture() {
      const c = useComposer({
        createEngine: () => new SilentAudioEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: createEmptyProject('p'),
        autosaveDelay: 0,
      })
      // Capture in an effect (not during render) to satisfy the purity lint rule.
      useEffect(() => {
        controller = c
      })
      return <PianoRoll controller={c} />
    }
    render(<Capture />)
    act(() => {
      controller!.insertNotes(controller!.selectedTrackId, [
        { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
        { pitch: 64, start: 1, duration: 1, velocity: 0.8 },
        { pitch: 67, start: 2, duration: 1, velocity: 0.8 },
      ])
    })
    const selected = screen
      .getAllByRole('button')
      .filter((b) => b.className.includes('pr-note') && b.className.includes('is-selected'))
    expect(selected).toHaveLength(3)
  })
})
