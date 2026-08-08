import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectToolbar } from './ProjectToolbar'
import { useComposer } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createDemoProject, createEmptyProject } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'

function Harness({ download }: { download: (b: Uint8Array, n: string) => void }) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  })
  return <ProjectToolbar controller={controller} download={download} />
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
    expect(bytes.byteLength).toBeGreaterThan(0)
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
    // Simulate an environment without URL.createObjectURL (e.g. jsdom/SSR).
    vi.stubGlobal('URL', {})
    render(<DefaultHarness />)
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Export MIDI' })),
    ).not.toThrow()
    vi.stubGlobal('URL', original)
    vi.unstubAllGlobals()
  })
})
