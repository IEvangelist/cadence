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
    expect(within(screen.getByRole('complementary', { name: 'Panels' })).queryByText(
      'Quick Starts',
    )).not.toBeInTheDocument()
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
  })

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
})
