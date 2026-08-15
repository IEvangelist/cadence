import { useEffect } from 'react'
/* Interaction coverage:
 * studio.piano-roll.zoom.time-out, studio.piano-roll.zoom.time-in,
 * studio.piano-roll.zoom.pitch-out, studio.piano-roll.zoom.pitch-in,
 * studio.piano-roll.zoom.reset, studio.piano-roll.quantize.strength,
 * studio.piano-roll.quantize.apply, studio.piano-roll.velocity.toggle,
 * studio.piano-roll.grid, studio.piano-roll.note,
 * studio.piano-roll.note.resize-start, studio.piano-roll.note.resize-end,
 * studio.piano-roll.velocity.note, studio.piano-roll.velocity.selected
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PianoRoll } from './PianoRoll'
import { useComposer } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject } from '../model/project'
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

  it('adds a note by clicking the grid and can delete it with the keyboard', () => {
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

  it('resizes a note by dragging its right (end) edge', () => {
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
    const user = userEvent.setup()
    mockGridRect()
    render(<Harness />)

    const zoom = screen.getByRole('status', { name: 'Current zoom' })
    await user.click(screen.getByRole('button', { name: 'Zoom in horizontally (time)' }))
    await user.click(screen.getByRole('button', { name: 'Zoom in vertically (pitch)' }))
    expect(zoom).not.toHaveTextContent('100% × 100%')
    await user.click(screen.getByRole('button', { name: 'Zoom out horizontally (time)' }))
    await user.click(screen.getByRole('button', { name: 'Zoom out vertically (pitch)' }))
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
    fireEvent.change(screen.getByRole('slider', { name: /Velocity/ }), {
      target: { value: '0.25' },
    })
    expect(velocityBar.getAttribute('aria-label')).not.toBe(before)
  })

  it('runs quantize on the selected note without dropping it', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    fireEvent.click(note)
    fireEvent.click(screen.getByRole('button', { name: /Quantize/ }))
    const after = screen.getAllByRole('button').filter((b) => b.className.includes('pr-note'))
    expect(after).toHaveLength(1)
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
