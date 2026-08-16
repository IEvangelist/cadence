import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { Composer } from './Composer'
import { SilentAudioEngine } from './audio/engine'
import {
  LocalStorageProjectStore,
  MemoryStorage,
  type ProjectStore,
} from './model/storage'
import { createEmptyProject } from './model/project'

function options() {
  return {
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  }
}

function failingReplacementOptions(save: ProjectStore['save']) {
  const backing = new LocalStorageProjectStore(new MemoryStorage())
  const store: ProjectStore = {
    save,
    load: (id) => backing.load(id),
    list: () => backing.list(),
    remove: (id) => backing.remove(id),
    loadLast: () => backing.loadLast(),
    setLast: (id) => backing.setLast(id),
  }
  return {
    ...options(),
    store,
    autosaveDelay: 60_000,
  }
}

async function chooseProjectCommand(
  user: ReturnType<typeof userEvent.setup>,
  command: 'New project' | 'Open project',
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Project' }))
  await user.click(await screen.findByRole('menuitem', { name: command }))
}

afterEach(() => {
  localStorage.clear()
})

describe('<Composer />', () => {
  it('renders the focused production mobile workspace and real task surfaces', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        media: '(max-width: 40rem), (pointer: coarse)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )

    render(<Composer options={options()} canShare />)

    expect(screen.getByRole('navigation', { name: 'Composer tasks' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Transport controls' })).toBeVisible()
    expect(screen.getByRole('application', { name: /Note grid/ })).toBeVisible()
    expect(screen.queryByTestId('onboarding-tour-root')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Project:/ }))
    expect(screen.getByTestId('mobile-project-sheet')).toBeVisible()
    expect(screen.getByText('Your project lives here')).toBeVisible()
    expect(
      within(screen.getByTestId('mobile-project-sheet')).getByRole('group', {
        name: 'Project toolbar',
      }),
    ).toBeVisible()
    expect(
      within(screen.getByTestId('mobile-project-sheet')).getByRole('button', {
        name: 'Share',
      }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close Project' }))

    await user.click(screen.getByRole('button', { name: /^Tracks:/ }))
    expect(screen.getByTestId('mobile-tracks-sheet')).toBeVisible()
    expect(
      within(screen.getByTestId('mobile-tracks-sheet')).getByRole('region', {
        name: 'Tracks',
      }),
    ).toBeVisible()
    expect(
      within(screen.getByTestId('mobile-tracks-sheet')).getByRole('region', {
        name: 'Track inspector',
      }),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close Tracks' }))

    await user.click(screen.getByRole('button', { name: /^Tools:/ }))
    expect(screen.getByTestId('mobile-tools-sheet')).toBeVisible()
    expect(
      within(screen.getByTestId('mobile-tools-sheet')).getByRole('region', {
        name: 'AI tools',
      }),
    ).toBeVisible()
  })

  it('shows the empty state and dismisses it after loading the demo', async () => {
    coversInteractions('studio.empty.load-demo')
    render(<Composer options={options()} />)
    expect(screen.getByText('Your canvas is empty.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load a demo pattern/ }))
    await waitFor(() =>
      expect(screen.queryByText('Your canvas is empty.')).not.toBeInTheDocument(),
    )
  })

  it('surfaces a note when audio output is unavailable', () => {
    render(<Composer options={options()} />)
    expect(screen.getByRole('note')).toHaveTextContent(/Audio output isn/)
  })

  it('composes the toolbar, transport, tracks, and piano roll', () => {
    render(<Composer options={options()} />)
    expect(screen.getByRole('group', { name: 'Project toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Transport controls' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tracks' })).toBeInTheDocument()
    expect(screen.getByRole('application', { name: /Note grid/ })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Track rail' })).queryByText(
      'Quick Starts',
    )).not.toBeInTheDocument()
  })

  it('mounts unified AI, Mix, extension tools, and persisted rail Solo in production', async () => {
    coversInteractions('studio.track.solo')
    const user = userEvent.setup()
    render(<Composer options={options()} />)

    const solo = screen.getByRole('button', { name: 'Solo Synth' })
    await user.click(solo)
    expect(solo).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    await user.click(screen.getByRole('tab', { name: 'AI' }))
    expect(screen.getByRole('region', { name: 'AI tools' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: 'AI Studio' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Advanced' }))
    expect(await screen.findByRole('region', { name: 'AI Studio' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: /^Mix$/ }))
    expect(screen.getByRole('region', { name: 'Mix workspace' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Mixer' })).toBeVisible()

    await user.click(screen.getByRole('tab', { name: 'Extensions' }))
    const extensions = screen.getByRole('region', { name: 'Extensions' })
    await user.click(within(extensions).getByRole('checkbox', { name: /Hello Cadence/ }))
    expect(screen.getByRole('region', { name: 'Example plugin' })).toBeVisible()
    await user.click(within(extensions).getByRole('checkbox', { name: 'Example plugin' }))
    expect(screen.queryByRole('region', { name: 'Example plugin' })).not.toBeInTheDocument()
  })

  it('shows Quick Starts in the initial Start Center, not the editor sidebar', async () => {
    render(
      <Composer
        options={{
          createEngine: () => new SilentAudioEngine(),
          store: new LocalStorageProjectStore(new MemoryStorage()),
          autosaveDelay: 0,
        }}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Start a project' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Quick Starts' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Panels' })).not.toBeInTheDocument()
  })

  it('opens New in the project browser without replacing the current project', async () => {
    coversInteractions(
      'studio.project-browser.close',
    )
    const user = userEvent.setup()
    render(<Composer options={options()} />)
    const name = screen.getByLabelText('Project name')
    await waitFor(() =>
      expect(document.querySelector('.toolbar-save-state')).toHaveTextContent(/^Saved/),
    )

    await chooseProjectCommand(user, 'New project')
    expect(await screen.findByRole('dialog', { name: 'Project browser' })).toBeInTheDocument()
    expect(name).toHaveValue('Untitled')
    await user.click(screen.getByRole('button', { name: 'Close project browser' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Project browser' })).not.toBeInTheDocument(),
    )
    expect(name).toHaveValue('Untitled')
  })

  it('awaits the replacement dialog and can keep editing after save failure', async () => {
    coversInteractions('studio.project-replacement.cancel')
    const user = userEvent.setup()
    const save = vi.fn<ProjectStore['save']>().mockRejectedValue(new Error('offline'))
    render(<Composer options={failingReplacementOptions(save)} />)
    const name = screen.getByLabelText('Project name')
    await user.clear(name)
    await user.type(name, 'Unsaved Work')
    await waitFor(() => expect(document.querySelector('.toolbar-save-state')).toHaveTextContent(
      'Unsaved changes',
    ))

    await chooseProjectCommand(user, 'New project')
    await user.click(await screen.findByRole('button', { name: /Blank project/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Current changes are not saved')
    expect(screen.getByRole('button', { name: 'Retry save' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(name).toHaveValue('Unsaved Work')
  }, 15_000)

  it('retries a blocked replacement and proceeds once saving recovers', async () => {
    coversInteractions('studio.project-replacement.retry')
    const user = userEvent.setup()
    const backing = new LocalStorageProjectStore(new MemoryStorage())
    const save = vi
      .fn<ProjectStore['save']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation((project) => backing.save(project))
    render(<Composer options={failingReplacementOptions(save)} />)
    await user.type(screen.getByLabelText('Project name'), ' changed')
    await waitFor(() => expect(document.querySelector('.toolbar-save-state')).toHaveTextContent(
      'Unsaved changes',
    ))

    await chooseProjectCommand(user, 'New project')
    await user.click(await screen.findByRole('button', { name: /Blank project/ }))
    await user.click(await screen.findByRole('button', { name: 'Retry save' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Project name')).toHaveValue('Untitled')
  })

  it('explicitly discards changes to finish a blocked replacement', async () => {
    coversInteractions('studio.project-replacement.discard')
    const user = userEvent.setup()
    const save = vi.fn<ProjectStore['save']>().mockRejectedValue(new Error('offline'))
    render(<Composer options={failingReplacementOptions(save)} />)
    await user.type(screen.getByLabelText('Project name'), ' changed')
    await waitFor(() => expect(document.querySelector('.toolbar-save-state')).toHaveTextContent(
      'Unsaved changes',
    ))

    await chooseProjectCommand(user, 'Open project')
    await user.click(await screen.findByRole('button', { name: /Demo pattern/ }))
    await user.click(await screen.findByRole('button', {
      name: 'Discard changes and continue',
    }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Project name')).toHaveValue('Demo — Every idea, resolved')
  })

  it('uses Space for transport while the piano-roll grid is focused', () => {
    render(<Composer options={options()} />)
    const grid = screen.getByRole('application', { name: /Note grid/ })
    grid.focus()

    fireEvent.keyDown(grid, { key: ' ' })

    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument()
    expect(screen.queryAllByRole('button').filter((button) =>
      button.className.includes('pr-note'),
    )).toHaveLength(0)
  })

  it('exposes undo, redo, and searchable shortcut help from the Studio command source', () => {
    coversInteractions(
      'studio.history.undo',
      'studio.history.redo',
      'studio.shortcuts.open',
    )
    render(<Composer options={options()} />)
    const grid = screen.getByRole('application', { name: /Note grid/ })
    fireEvent.keyDown(grid, { key: 'Enter' })
    const notes = () =>
      screen.queryAllByRole('button').filter((button) => button.className.includes('pr-note'))
    expect(notes()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(notes()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(notes()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('restores shortcut help to its toolbar trigger when opened from the document body', async () => {
    const user = userEvent.setup()
    localStorage.setItem('cadence.v1.onboarding.seen', '1')
    render(<Composer options={options()} />)
    document.body.focus()

    fireEvent.keyDown(document.body, { key: '?' })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveFocus()
  })

  it('restores shortcut help to an interactive keyboard invoker', async () => {
    const user = userEvent.setup()
    localStorage.setItem('cadence.v1.onboarding.seen', '1')
    render(<Composer options={options()} />)
    const addTrack = screen.getByRole('button', { name: 'Add track' })
    addTrack.focus()

    fireEvent.keyDown(addTrack, { key: '?' })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(addTrack).toHaveFocus()
  })
})
