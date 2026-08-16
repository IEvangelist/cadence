import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import type { ComposerController } from '../hooks/useComposer'
import { HOUSE_DUBS } from '../templates'
import { StartCenter } from './StartCenter'

function controller(
  overrides: Partial<ComposerController> = {},
): ComposerController {
  return {
    hydration: { status: 'ready-without-project' },
    recentProjectsState: { status: 'ready' },
    savedProjects: [],
    formats: [],
    replaceWithBlank: vi.fn().mockResolvedValue('replaced'),
    replaceWithDemo: vi.fn().mockResolvedValue('replaced'),
    replaceWithTemplate: vi.fn().mockResolvedValue('replaced'),
    openStoredProject: vi.fn().mockResolvedValue('replaced'),
    replaceWithMidi: vi.fn().mockResolvedValue('replaced'),
    replaceWithMusicXml: vi.fn().mockResolvedValue('replaced'),
    replaceWithProjectFile: vi.fn().mockResolvedValue('replaced'),
    replaceWithPluginFormat: vi.fn().mockResolvedValue('replaced'),
    refreshSavedProjects: vi.fn().mockResolvedValue(undefined),
    retryHydration: vi.fn(),
    continueToStartCenter: vi.fn(),
    notify: vi.fn(),
    notifyError: vi.fn(),
    ...overrides,
  } as unknown as ComposerController
}

function textFile(contents: string, name: string, type: string): File {
  const file = new File([contents], name, { type })
  Object.defineProperty(file, 'text', { value: async () => contents })
  return file
}

function midiFile(bytes: Uint8Array, name: string): File {
  const file = new File([bytes as BlobPart], name, { type: 'audio/midi' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  })
  return file
}

describe('<StartCenter />', () => {
  it('starts blank and demo projects, closing only after replacement succeeds', async () => {
    coversInteractions('start-center.blank', 'studio.project.demo')
    const user = userEvent.setup()
    const onProjectReady = vi.fn()
    const value = controller()
    render(<StartCenter controller={value} onProjectReady={onProjectReady} />)

    await user.click(screen.getByRole('button', { name: /Blank project/ }))
    await waitFor(() => expect(value.replaceWithBlank).toHaveBeenCalledOnce())
    expect(onProjectReady).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: /Demo pattern/ }))
    await waitFor(() => expect(value.replaceWithDemo).toHaveBeenCalledOnce())
    expect(onProjectReady).toHaveBeenCalledTimes(2)
  })

  it('opens a recent project and a Quick Start template', async () => {
    coversInteractions('start-center.recent.open')
    const user = userEvent.setup()
    const value = controller({
      savedProjects: [{ id: 'recent-1', name: 'Evening Sketch', updatedAt: 1_700_000_000_000 }],
    })
    render(<StartCenter controller={value} />)

    await user.click(screen.getByRole('button', { name: /Evening Sketch/ }))
    expect(value.openStoredProject).toHaveBeenCalledWith('recent-1')

    await user.click(screen.getByRole('button', { name: new RegExp(HOUSE_DUBS[0].name) }))
    expect(value.replaceWithTemplate).toHaveBeenCalledWith(HOUSE_DUBS[0])
  })

  it('opens both hidden import choosers from their visible actions', async () => {
    coversInteractions(
      'start-center.import.trigger',
      'start-center.midi-import.trigger',
    )
    const user = userEvent.setup()
    render(<StartCenter controller={controller()} />)
    const projectInput = screen.getByLabelText('Import project or MusicXML from Start Center')
    const midiInput = screen.getByLabelText('Import MIDI from Start Center')
    const projectClick = vi.spyOn(projectInput, 'click').mockImplementation(() => {})
    const midiClick = vi.spyOn(midiInput, 'click').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: /Import project/ }))
    expect(projectClick).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /Import MIDI/ }))
    expect(midiClick).toHaveBeenCalledOnce()
  })

  it('routes project, MusicXML, and plugin files to their matching importers', async () => {
    coversInteractions('start-center.import.file')
    const user = userEvent.setup()
    const value = controller({
      formats: [{
        id: 'lead-sheet',
        name: 'Lead sheet',
        extension: '.lead',
        mimeType: 'text/plain',
        import: vi.fn(),
      }],
    })
    render(<StartCenter controller={value} />)
    const input = screen.getByLabelText('Import project or MusicXML from Start Center')

    await user.upload(
      input,
      textFile('{"format":"cadence-project"}', 'portable.cadence.json', 'application/json'),
    )
    await waitFor(() =>
      expect(value.replaceWithProjectFile).toHaveBeenCalledWith(
        '{"format":"cadence-project"}',
        'portable',
      ),
    )

    await user.upload(input, textFile('<score-partwise/>', 'score.musicxml', 'application/xml'))
    await waitFor(() =>
      expect(value.replaceWithMusicXml).toHaveBeenCalledWith('<score-partwise/>', 'score'),
    )

    await user.upload(input, textFile('Cmaj7', 'changes.lead', 'text/plain'))
    await waitFor(() =>
      expect(value.replaceWithPluginFormat).toHaveBeenCalledWith(
        'lead-sheet',
        'Cmaj7',
        'changes',
      ),
    )
  })

  it('imports MIDI bytes as a new project', async () => {
    coversInteractions('start-center.midi-import.file')
    const user = userEvent.setup()
    const value = controller()
    render(<StartCenter controller={value} />)

    await user.upload(
      screen.getByLabelText('Import MIDI from Start Center'),
      midiFile(new Uint8Array([0x4d, 0x54, 0x68, 0x64]), 'beat.mid'),
    )
    await waitFor(() => expect(value.replaceWithMidi).toHaveBeenCalledOnce())
    const [bytes, name] = vi.mocked(value.replaceWithMidi).mock.calls[0]
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0x4d, 0x54, 0x68, 0x64]))
    expect(name).toBe('beat')
  })

  it('offers retry and continue after restore failure', async () => {
    coversInteractions('start-center.restore.retry', 'start-center.restore.continue')
    const user = userEvent.setup()
    const value = controller({
      hydration: { status: 'restore-error', message: 'Storage is unavailable.' },
    })
    render(<StartCenter controller={value} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Storage is unavailable.')
    await user.click(screen.getByRole('button', { name: 'Retry restore' }))
    expect(value.retryHydration).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Continue to Start Center' }))
    expect(value.continueToStartCenter).toHaveBeenCalledOnce()
  })

  it('shows recent-project errors and retries their query', async () => {
    coversInteractions('start-center.recents.retry')
    const user = userEvent.setup()
    const value = controller({
      recentProjectsState: { status: 'error', message: 'Recent projects unavailable.' },
    })
    render(<StartCenter controller={value} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Recent projects unavailable.')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(value.refreshSavedProjects).toHaveBeenCalledOnce()
  })

  it.each(['initial', 'browser'] as const)(
    'renders destination errors inline in %s mode',
    (mode) => {
      render(
        <StartCenter
          mode={mode}
          controller={controller({
            actionMessage: {
              id: 1,
              tone: 'error',
              text: 'Could not open project',
            },
          })}
        />,
      )

      expect(screen.getByRole('alert')).toHaveTextContent('Could not open project')
    },
  )

  it('surfaces file read failures through the inline error channel', async () => {
    const user = userEvent.setup()
    const value = controller()
    render(<StartCenter controller={value} />)
    const unreadable = new File(['x'], 'broken.cadence.json')
    Object.defineProperty(unreadable, 'text', {
      value: async () => Promise.reject(new Error('read failed')),
    })

    await user.upload(
      screen.getByLabelText('Import project or MusicXML from Start Center'),
      unreadable,
    )

    await waitFor(() =>
      expect(value.notifyError).toHaveBeenCalledWith('Cadence could not read that file.'),
    )
  })
})
