import { fireEvent, render, screen, waitFor } from '@testing-library/react'
/* Interaction coverage:
 * studio.project.name, studio.project.new, studio.project.demo, studio.project.save,
 * studio.project.open, studio.project.import.trigger, studio.project.import.file,
 * studio.project.export, studio.project.share, studio.project.midi-import.trigger,
 * studio.project.midi-import.file, studio.project.midi-export
 */
import { describe, expect, it, vi } from 'vitest'
import { ProjectToolbar } from './ProjectToolbar'
import { useComposer, type UseComposerOptions } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createDemoProject, createEmptyProject } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'
import { projectToFile } from '../formats/projectFile'
import { projectToMusicXml } from '../formats/musicxml'

type DownloadFn = (data: Uint8Array | string, filename: string, mime?: string) => void
type CopyFn = (text: string) => void

interface HarnessProps {
  download?: DownloadFn
  copyText?: CopyFn
  options?: Partial<UseComposerOptions>
}

function Harness({ download, copyText, options }: HarnessProps) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
    ...options,
  })
  return (
    <ProjectToolbar controller={controller} download={download} copyText={copyText} />
  )
}

function DefaultHarness() {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  })
  return <ProjectToolbar controller={controller} />
}

const selectValue = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('<ProjectToolbar />', () => {
  it('renames, loads the demo, and creates a new project', () => {
    render(<Harness download={vi.fn()} />)
    const name = screen.getByLabelText('Project name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Hello' } })
    expect(name.value).toBe('Hello')

    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toContain('Demo')

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Untitled')
  })

  it('exports the project to a downloadable .mid file', () => {
    const download = vi.fn()
    render(<Harness download={download} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export MIDI' }))
    expect(download).toHaveBeenCalledTimes(1)
    const [bytes, filename] = download.mock.calls[0]
    expect((bytes as Uint8Array).byteLength).toBeGreaterThan(0)
    expect(filename).toMatch(/\.mid$/)
  })

  it('saves a project and lists it under Open', async () => {
    render(<Harness download={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Track One' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Track One' })).toBeInTheDocument(),
    )
  })

  it('imports a MIDI file into the project', async () => {
    render(<Harness download={vi.fn()} />)
    const bytes = projectToMidiBytes(createDemoProject('demo'))
    const file = new File([bytes as BlobPart], 'my-song.mid', { type: 'audio/midi' })
    const input = screen.getByLabelText('Import MIDI file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported MIDI'))
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('my-song')
  })

  it('uses the real browser download when no override is provided', () => {
    const createObjectURL = vi.fn(() => 'blob:cadence')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<DefaultHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Export MIDI' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cadence')

    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('no-ops the default download when object URLs are unavailable', () => {
    const original = globalThis.URL
    vi.stubGlobal('URL', {})
    render(<DefaultHarness />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Export MIDI' })),
    ).not.toThrow()
    vi.stubGlobal('URL', original)
    vi.unstubAllGlobals()
  })
})

describe('<ProjectToolbar /> — multi-format export', () => {
  it('exports a MusicXML file', async () => {
    const download = vi.fn()
    render(<Harness download={download} />)
    selectValue('Export as', 'musicxml')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [data, filename, mime] = download.mock.calls[0]
    expect(filename).toMatch(/\.musicxml$/)
    expect(mime).toContain('musicxml')
    expect(data as string).toContain('<score-partwise')
  })

  it('exports a portable .cadence.json project file', async () => {
    const download = vi.fn()
    render(<Harness download={download} />)
    selectValue('Export as', 'project')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [data, filename] = download.mock.calls[0]
    expect(filename).toMatch(/\.cadence\.json$/)
    expect(JSON.parse(data as string).format).toBe('cadence-project')
  })

  it('renders audio to a downloadable .wav via the injected renderer', async () => {
    const download = vi.fn()
    const audioRenderer = vi.fn(async (_p, durationSeconds: number, rate: number) => ({
      sampleRate: rate,
      channels: [new Float32Array(Math.max(1, Math.round(durationSeconds * rate)))],
    }))
    render(<Harness download={download} options={{ audioRenderer }} />)
    selectValue('Export as', 'wav')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [data, filename, mime] = download.mock.calls[0]
    expect(filename).toMatch(/\.wav$/)
    expect(mime).toBe('audio/wav')
    expect((data as Uint8Array).byteLength).toBeGreaterThan(44)
    expect(audioRenderer).toHaveBeenCalledOnce()
  })

  it('renders audio to a downloadable .mp3 via the injected renderer', async () => {
    const download = vi.fn()
    const audioRenderer = vi.fn(async (_p, durationSeconds: number, rate: number) => {
      const frames = Math.max(1, Math.round(durationSeconds * rate))
      const channel = new Float32Array(frames)
      for (let i = 0; i < frames; i += 1) channel[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5
      return { sampleRate: rate, channels: [channel] }
    })
    render(<Harness download={download} options={{ audioRenderer }} />)
    selectValue('Export as', 'mp3')
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [data, filename, mime] = download.mock.calls[0]
    expect(filename).toMatch(/\.mp3$/)
    expect(mime).toBe('audio/mpeg')
    const bytes = data as Uint8Array
    expect(bytes.byteLength).toBeGreaterThan(0)
    // Valid MP3 frame sync header (0xFF 0xEx).
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)
    expect(audioRenderer).toHaveBeenCalledOnce()
  })

  it('reports a friendly status when audio rendering is unavailable', async () => {
    render(<Harness download={vi.fn()} />)
    selectValue('Export as', 'wav')
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Couldn.t render audio/),
    )
  })
})

describe('<ProjectToolbar /> — multi-format import', () => {
  it('opens a .cadence.json project file', async () => {
    render(<Harness download={vi.fn()} />)
    const text = projectToFile(createDemoProject('demo'))
    const file = new File([text], 'my-project.cadence.json', { type: 'application/json' })
    const input = screen.getByLabelText('Import project or MusicXML file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Opened project file'),
    )
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('my-project')
  })

  it('imports a MusicXML file', async () => {
    render(<Harness download={vi.fn()} />)
    const xml = projectToMusicXml(createDemoProject('demo'))
    const file = new File([xml], 'score.musicxml', { type: 'application/xml' })
    const input = screen.getByLabelText('Import project or MusicXML file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Imported MusicXML'),
    )
  })

  it('surfaces a typed error status for a malformed import', async () => {
    render(<Harness download={vi.fn()} />)
    const file = new File(['not a real project'], 'broken.cadence.json', {
      type: 'application/json',
    })
    const input = screen.getByLabelText('Import project or MusicXML file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Couldn.t open that file/),
    )
  })

  it('opens a .cadence.json whose content contains "score-partwise" as a project', async () => {
    render(<Harness download={vi.fn()} />)
    const project = createDemoProject('demo')
    project.name = 'my score-partwise piece'
    const text = projectToFile(project)
    expect(text).toContain('score-partwise') // the substring that used to misroute
    const file = new File([text], 'tricky.cadence.json', { type: 'application/json' })
    const input = screen.getByLabelText('Import project or MusicXML file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Opened project file'),
    )
    expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('tricky')
  })
})

describe('<ProjectToolbar /> — share', () => {
  it('copies a shareable link for a small project', async () => {
    const copyText = vi.fn()
    render(<Harness download={vi.fn()} copyText={copyText} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1))
    expect(copyText.mock.calls[0][0]).toContain('#project=')
    expect(screen.getByRole('status')).toHaveTextContent('Copied a shareable link')
  })

  it('falls back to downloading the file for a large project', async () => {
    const download = vi.fn()
    const dense = createEmptyProject('big')
    dense.tracks[0].notes = Array.from({ length: 400 }, (_, i) => ({
      id: `n${i}`,
      pitch: 60 + (i % 24),
      start: i * 0.25,
      duration: 0.25,
      velocity: 0.8,
    }))
    render(
      <Harness download={download} copyText={vi.fn()} options={{ initialProject: dense }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(download.mock.calls[0][1]).toMatch(/\.cadence\.json$/)
  })

  it('uses the default clipboard writer when no override is provided', () => {
    const writeText = vi.fn((text: string) => Promise.resolve(text))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<DefaultHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('#project=')
    vi.unstubAllGlobals()
  })
})
