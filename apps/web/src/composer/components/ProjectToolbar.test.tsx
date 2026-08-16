import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { ProjectToolbar } from './ProjectToolbar'
import {
  useComposer,
  type ComposerController,
  type UseComposerOptions,
} from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import {
  LocalStorageProjectStore,
  MemoryStorage,
} from '../model/storage'
import { createDemoProject, createEmptyProject } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'
import { projectToFile } from '../formats/projectFile'
import { projectToMusicXml } from '../formats/musicxml'
import { defaultPluginHost } from '../plugins/defaultHost'

type DownloadFn = (data: Uint8Array | string, filename: string, mime?: string) => void

interface HarnessProps {
  download?: DownloadFn
  copyText?: (text: string) => void
  options?: Partial<UseComposerOptions>
  onNewProject?: () => void
  onOpenProject?: () => void
}

function Harness({
  download,
  copyText,
  options,
  onNewProject,
  onOpenProject,
}: HarnessProps) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
    ...options,
  })
  return (
    <ProjectToolbar
      controller={controller}
      download={download}
      copyText={copyText}
      onNewProject={onNewProject}
      onOpenProject={onOpenProject}
    />
  )
}

async function chooseMenuItem(
  user: ReturnType<typeof userEvent.setup>,
  trigger: string,
  item: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: trigger }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

function textFile(contents: string, name: string, type: string): File {
  const file = new File([contents], name, { type })
  Object.defineProperty(file, 'text', { value: async () => contents })
  return file
}

afterEach(() => {
  defaultPluginHost.unregister('test.formats')
  vi.unstubAllGlobals()
})

describe('<ProjectToolbar />', () => {
  it('renames the project and delegates New/Open without replacing it', async () => {
    coversInteractions(
      'studio.project.name',
      'studio.project.menu.toggle',
      'studio.project.new',
      'studio.project.open',
    )
    const user = userEvent.setup()
    const onNewProject = vi.fn()
    const onOpenProject = vi.fn()
    render(
      <Harness
        download={vi.fn()}
        onNewProject={onNewProject}
        onOpenProject={onOpenProject}
      />,
    )
    const name = screen.getByLabelText('Project name')
    await user.clear(name)
    await user.type(name, 'Still Here')

    await chooseMenuItem(user, 'Project', 'New project')
    expect(onNewProject).toHaveBeenCalledOnce()
    expect(name).toHaveValue('Still Here')

    await chooseMenuItem(user, 'Project', 'Open project')
    expect(onOpenProject).toHaveBeenCalledOnce()
    expect(name).toHaveValue('Still Here')
  })

  it('opens each hidden file chooser from its awaited Radix menu action', async () => {
    coversInteractions(
      'studio.project.import.trigger',
      'studio.project.midi-import.trigger',
    )
    const user = userEvent.setup()
    render(<Harness download={vi.fn()} />)
    const projectInput = screen.getByLabelText('Import project or MusicXML file')
    const midiInput = screen.getByLabelText('Import MIDI file')
    const projectClick = vi.spyOn(projectInput, 'click').mockImplementation(() => {})
    const midiClick = vi.spyOn(midiInput, 'click').mockImplementation(() => {})

    await chooseMenuItem(user, 'Project', 'Import file')
    expect(projectClick).toHaveBeenCalledOnce()
    await chooseMenuItem(user, 'Project', 'Import MIDI')
    expect(midiClick).toHaveBeenCalledOnce()
  })

  it('shows explicit save state separately from the latest project action', async () => {
    coversInteractions('studio.project.save')
    const user = userEvent.setup()
    render(<Harness download={vi.fn()} options={{ autosaveDelay: 60_000 }} />)
    const name = screen.getByLabelText('Project name')
    await user.clear(name)
    await user.type(name, 'Explicit Save')

    await waitFor(() =>
      expect(document.querySelector('.toolbar-save-state')).toHaveTextContent('Unsaved changes'),
    )
    expect(document.querySelector('.toolbar-status')).toBeEmptyDOMElement()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(document.querySelector('.toolbar-save-state')).toHaveTextContent(/^Saved|All changes saved/),
    )
    expect(document.querySelector('.toolbar-status')).toHaveTextContent('Saved')
  })

  it('exposes a separate retry action after a failed explicit save', async () => {
    coversInteractions('studio.save.retry')
    const user = userEvent.setup()
    const retrySave = vi.fn().mockResolvedValue(undefined)
    const value = {
      project: createEmptyProject('failed-save'),
      saveState: {
        status: 'error',
        revision: 1,
        persistedRevision: 0,
        savingRevision: null,
        savedAt: null,
        message: 'Cadence could not save your latest changes.',
      },
      actionMessage: { id: 1, tone: 'error', text: 'Last action failed' },
      formats: [],
      setProjectName: vi.fn(),
      saveProject: vi.fn().mockResolvedValue(undefined),
      retrySave,
    } as unknown as ComposerController
    render(<ProjectToolbar controller={value} download={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(document.querySelector('.toolbar-status')).toHaveTextContent('Last action failed')
    await user.click(screen.getByRole('button', { name: 'Retry save' }))
    expect(retrySave).toHaveBeenCalledOnce()
  })

  it('imports MIDI and all built-in text formats', async () => {
    coversInteractions(
      'studio.project.midi-import.file',
      'studio.project.import.file',
    )
    const user = userEvent.setup()
    render(<Harness download={vi.fn()} />)
    const midi = projectToMidiBytes(createDemoProject('demo'))
    const midiFile = new File([midi as BlobPart], 'my-song.mid', { type: 'audio/midi' })
    Object.defineProperty(midiFile, 'arrayBuffer', {
      value: async () =>
        midi.buffer.slice(midi.byteOffset, midi.byteOffset + midi.byteLength) as ArrayBuffer,
    })

    await user.upload(screen.getByLabelText('Import MIDI file'), midiFile)
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveValue('my-song'))

    await user.upload(
      screen.getByLabelText('Import project or MusicXML file'),
      textFile(projectToFile(createDemoProject('portable')), 'portable.cadence.json', 'application/json'),
    )
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveValue('portable'))

    await user.upload(
      screen.getByLabelText('Import project or MusicXML file'),
      textFile(projectToMusicXml(createDemoProject('score')), 'score.musicxml', 'application/xml'),
    )
    await waitFor(() =>
      expect(document.querySelector('.toolbar-status')).toHaveTextContent('Imported MusicXML'),
    )
  })

  it('downloads every built-in export path from the Radix menu', async () => {
    coversInteractions(
      'studio.project.export',
      'studio.project.export.format',
      'studio.project.midi-export',
    )
    const user = userEvent.setup()
    const download = vi.fn()
    const audioRenderer = vi.fn(async (_project, durationSeconds: number, rate: number) => {
      const frames = Math.max(1, Math.round(durationSeconds * rate))
      const channel = new Float32Array(frames)
      for (let i = 0; i < frames; i += 1) {
        channel[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.25
      }
      return { sampleRate: rate, channels: [channel] }
    })
    render(<Harness download={download} options={{ audioRenderer }} />)

    await chooseMenuItem(user, 'Export & share', 'Export MusicXML (.musicxml)')
    await chooseMenuItem(user, 'Export & share', 'Export Project file (.cadence.json)')
    await chooseMenuItem(user, 'Export & share', 'Export WAV audio')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(3))
    await chooseMenuItem(user, 'Export & share', 'Export MP3 audio')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(4))
    await chooseMenuItem(user, 'Export & share', 'Export MIDI')

    expect(download.mock.calls.map(([, filename]) => filename)).toEqual([
      expect.stringMatching(/\.musicxml$/),
      expect.stringMatching(/\.cadence\.json$/),
      expect.stringMatching(/\.wav$/),
      expect.stringMatching(/\.mp3$/),
      expect.stringMatching(/\.mid$/),
    ])
    expect(String(download.mock.calls[0][0])).toContain('<score-partwise')
    expect(JSON.parse(download.mock.calls[1][0] as string).format).toBe('cadence-project')
    expect((download.mock.calls[2][0] as Uint8Array).byteLength).toBeGreaterThan(44)
    expect((download.mock.calls[3][0] as Uint8Array).byteLength).toBeGreaterThan(0)
    expect((download.mock.calls[4][0] as Uint8Array).byteLength).toBeGreaterThan(0)
  }, 15_000)

  it('exports and imports a plugin-contributed format', async () => {
    const user = userEvent.setup()
    defaultPluginHost.use({
      manifest: { id: 'test.formats', name: 'Test formats', version: '1.0.0' },
      contributes: {
        formats: [{
          id: 'lead-sheet',
          name: 'Lead sheet (.lead)',
          extension: '.lead',
          mimeType: 'text/plain',
          export: () => 'Cmaj7 | Fmaj7',
          import: (_data, options) => {
            const project = createDemoProject(options?.id ?? 'lead')
            project.name = options?.name ?? project.name
            return project
          },
        }],
      },
    })
    const download = vi.fn()
    render(<Harness download={download} />)

    await chooseMenuItem(user, 'Export & share', 'Export Lead sheet (.lead)')
    expect(download).toHaveBeenCalledWith(
      'Cmaj7 | Fmaj7',
      expect.stringMatching(/\.lead$/),
      'text/plain',
    )

    await user.upload(
      screen.getByLabelText('Import project or MusicXML file'),
      textFile('Dm7 | G7', 'changes.lead', 'text/plain'),
    )
    await waitFor(() => expect(screen.getByLabelText('Project name')).toHaveValue('changes'))
    expect(document.querySelector('.toolbar-status')).toHaveTextContent('Imported Lead sheet')
  })

  it('shares a URL snapshot and falls back to a project download when needed', async () => {
    coversInteractions('studio.project.share')
    const user = userEvent.setup()
    const copyText = vi.fn()
    render(<Harness download={vi.fn()} copyText={copyText} />)
    await chooseMenuItem(user, 'Export & share', 'Share snapshot')
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining('#project='))

    const dense = createEmptyProject('big')
    dense.tracks[0].notes = Array.from({ length: 400 }, (_, index) => ({
      id: `n${index}`,
      pitch: 60 + (index % 24),
      start: index * 0.25,
      duration: 0.25,
      velocity: 0.8,
    }))
    const download = vi.fn()
    render(
      <Harness
        download={download}
        copyText={vi.fn()}
        options={{ initialProject: dense }}
      />,
    )
    const exportButtons = screen.getAllByRole('button', { name: 'Export & share' })
    await user.click(exportButtons[1])
    const shareItems = await screen.findAllByRole('menuitem', { name: 'Share snapshot' })
    await user.click(shareItems.at(-1) as HTMLElement)
    expect(download).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\.cadence\.json$/),
      'application/json',
    )
  })
})
