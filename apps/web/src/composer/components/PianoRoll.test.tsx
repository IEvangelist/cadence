import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('selects a note and edits its velocity', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 96, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    fireEvent.click(note)
    const velocity = screen.getByRole('slider', { name: /Velocity/ }) as HTMLInputElement
    fireEvent.change(velocity, { target: { value: '0.5' } })
    expect(velocity.value).toBe('0.5')
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

  it('resizes a note by dragging its right edge', () => {
    mockGridRect()
    render(<Harness />)
    const grid = screen.getByRole('application')
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 80 })
    const note = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    const beforeWidth = note.style.width
    const handle = within(note).getByRole('generic', { hidden: true })

    fireEvent.pointerDown(handle, { clientX: DEFAULT_LAYOUT.beatWidth, clientY: 80 })
    fireEvent.pointerMove(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })
    fireEvent.pointerUp(window, { clientX: DEFAULT_LAYOUT.beatWidth * 3, clientY: 80 })

    const resized = screen.getAllByRole('button').find((b) => b.className.includes('pr-note'))!
    expect(resized.style.width).not.toBe(beforeWidth)
  })
})
