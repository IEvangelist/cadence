import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
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

  return (
    <StudioFrame
      projectControls={<button type="button">Project menu</button>}
      transportControls={<button type="button">Play</button>}
      rail={<button type="button">Track one</button>}
      editor={<div role="application" aria-label="Piano roll" tabIndex={0} />}
      inspector={inspector ? <button type="button">Detail control</button> : undefined}
      mix={<div role="application" aria-label="Mixer" tabIndex={0} />}
      collaborationControls={<button type="button">Share</button>}
      utilityControls={<button type="button">Help</button>}
      view={view}
      onViewChange={setView}
      railOpen={railOpen}
      inspectorOpen={inspectorOpen}
      onInspectorToggle={() => setInspectorOpen((open) => !open)}
    />
  )
}

function PlaybackReadout() {
  const { isPlaying } = useStudioCommands()
  return <output aria-label="Playback state">{isPlaying ? 'playing' : 'stopped'}</output>
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
    const user = userEvent.setup()
    const { rerender } = render(<FrameHarness />)

    expect(screen.queryByRole('complementary', { name: 'Inspector' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()

    rerender(<FrameHarness railOpen={false} />)
    expect(screen.queryByRole('complementary', { name: 'Track rail' })).not.toBeInTheDocument()
  })

  it('keeps the requested keyboard order in DOM order', async () => {
    const user = userEvent.setup()
    render(<FrameHarness />)

    const expected = [
      'Project menu',
      'Play',
      'Track one',
      'Piano roll',
      'Write',
      'Mix',
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
})
