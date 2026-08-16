import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { StudioCommandProvider } from './StudioCommandProvider'
import { StudioFrame, type StudioView } from './StudioFrame'
import { useStudioCommands } from './studioCommands'

function FrameHarness({
  inspector = true,
  railOpen = true,
}: {
  inspector?: boolean
  railOpen?: boolean
}) {
  const [view, setView] = useState<StudioView>('write')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [visibleRail, setVisibleRail] = useState(railOpen)

  return (
    <StudioFrame
      projectControls={<button type="button">Project menu</button>}
      transportControls={<StatefulTransport />}
      rail={<button type="button">Track one</button>}
      editor={<div role="application" aria-label="Piano roll" tabIndex={0} />}
      inspector={inspector ? <button type="button">Detail control</button> : undefined}
      mix={<div role="application" aria-label="Mixer" tabIndex={0} />}
      collaborationControls={<button type="button">Share</button>}
      utilityControls={<button type="button">Help</button>}
      view={view}
      onViewChange={setView}
      railOpen={visibleRail}
      onRailToggle={() => setVisibleRail((open) => !open)}
      inspectorOpen={inspectorOpen}
      onInspectorToggle={() => setInspectorOpen((open) => !open)}
    />
  )
}

function StatefulTransport() {
  const [position, setPosition] = useState(0)
  return (
    <button type="button" onClick={() => setPosition((value) => value + 1)}>
      Play {position}
    </button>
  )
}

function PlaybackReadout() {
  const { isPlaying, togglePlay } = useStudioCommands()
  return (
    <>
      <output aria-label="Playback state">{isPlaying ? 'playing' : 'stopped'}</output>
      <button type="button" onClick={togglePlay}>Toggle from context</button>
    </>
  )
}

function CommandHarness({
  isPlaying,
  togglePlay,
}: {
  isPlaying: boolean
  togglePlay: () => void
}) {
  return (
    <StudioCommandProvider isPlaying={isPlaying} togglePlay={togglePlay}>
      <div data-studio-workbench>
        <PlaybackReadout />
      </div>
    </StudioCommandProvider>
  )
}

describe('<StudioFrame />', () => {
  it('switches between real Write and Mix workspace surfaces', async () => {
    coversInteractions('studio.view.write', 'studio.view.mix')
    const user = userEvent.setup()
    render(<FrameHarness />)

    expect(screen.getByRole('application', { name: 'Piano roll' })).toBeInTheDocument()
    expect(screen.queryByRole('application', { name: 'Mixer' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mix' }))

    expect(screen.queryByRole('application', { name: 'Piano roll' })).not.toBeInTheDocument()
    expect(screen.getByRole('application', { name: 'Mixer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mix' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('removes closed auxiliary surfaces from the accessibility tree', async () => {
    coversInteractions('studio.inspector.toggle')
    const user = userEvent.setup()
    render(<FrameHarness />)

    expect(screen.queryByRole('complementary', { name: 'Inspector' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspector' })).not.toHaveAttribute('aria-controls')
    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspector' })).toHaveAttribute('aria-controls')

    await user.click(screen.getByRole('button', { name: 'Tracks' }))
    expect(screen.queryByRole('complementary', { name: 'Track rail' })).not.toBeInTheDocument()
  })

  it('keeps the requested keyboard order in DOM order', async () => {
    const user = userEvent.setup()
    render(<FrameHarness />)

    const expected = [
      'Project menu',
      'Play 0',
      'Track one',
      'Piano roll',
      'Write',
      'Mix',
      'Tracks',
      'Inspector',
      'Share',
      'Help',
    ]

    for (const name of expected) {
      await user.tab()
      expect(
        name === 'Piano roll'
          ? screen.getByRole('application', { name })
          : screen.getByRole('button', { name }),
      ).toHaveFocus()
    }
  })

  it('preserves persistent transport state while the workspace view changes', async () => {
    const user = userEvent.setup()
    render(<FrameHarness />)

    await user.click(screen.getByRole('button', { name: 'Play 0' }))
    expect(screen.getByRole('button', { name: 'Play 1' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mix' }))
    expect(screen.getByRole('button', { name: 'Play 1' })).toBeInTheDocument()
  })

  it('reallocates the rail column while keeping a visible restore control', async () => {
    coversInteractions('studio.rail.toggle')
    const user = userEvent.setup()
    render(<FrameHarness />)

    await user.click(screen.getByRole('button', { name: 'Tracks' }))

    expect(screen.queryByRole('complementary', { name: 'Track rail' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tracks' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

describe('<StudioCommandProvider />', () => {
  it('exposes the current play state to stacked Studio controls', () => {
    const togglePlay = () => undefined
    const { rerender } = render(
      <CommandHarness isPlaying={false} togglePlay={togglePlay} />,
    )
    expect(screen.getByRole('status', { name: 'Playback state' })).toHaveTextContent('stopped')

    rerender(<CommandHarness isPlaying togglePlay={togglePlay} />)
    expect(screen.getByRole('status', { name: 'Playback state' })).toHaveTextContent('playing')
  })

  it('exposes the transport command without owning its dispatcher', async () => {
    const user = userEvent.setup()
    const togglePlay = vi.fn()
    render(<CommandHarness isPlaying={false} togglePlay={togglePlay} />)

    await user.click(screen.getByRole('button', { name: 'Toggle from context' }))

    expect(togglePlay).toHaveBeenCalledOnce()
  })
})
