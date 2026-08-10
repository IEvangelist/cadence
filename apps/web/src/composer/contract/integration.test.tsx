import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  createEmptyProject,
  LocalStorageProjectStore,
  MemoryStorage,
  type ComposerPublicApi,
  type CompositionAssistant,
} from '.'
import { SilentAudioEngine } from '../audio/engine'
import { useAssistant } from '../hooks/useAssistant'
import { useComposer } from '../hooks/useComposer'

function renderComposer(
  store = new LocalStorageProjectStore(new MemoryStorage()),
  projectId = 'contract_project',
) {
  const hook = renderHook(() =>
    useComposer({
      store,
      createEngine: () => new SilentAudioEngine(),
      initialProject: createEmptyProject(projectId),
      autosaveDelay: 0,
    }),
  )
  return { hook, store }
}

describe('composer contract integration', () => {
  it('drives shared composer surfaces through the frozen controller API', async () => {
    const { hook, store } = renderComposer()
    const api: ComposerPublicApi = hook.result.current
    expect(api.project.id).toBe('contract_project')

    const initialTrackCount = hook.result.current.project.tracks.length
    act(() => hook.result.current.addTrack())
    expect(hook.result.current.project.tracks).toHaveLength(initialTrackCount + 1)

    const trackId = hook.result.current.project.tracks[1].id
    act(() => hook.result.current.selectTrack(trackId))
    expect(hook.result.current.selectedTrackId).toBe(trackId)

    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    act(() =>
      hook.result.current.insertNotes(trackId, [
        { pitch: 64, start: 2, duration: 1, velocity: 0.7 },
        { pitch: 67, start: 7, duration: 2, velocity: 0.6 },
      ]),
    )
    let track = hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(track?.notes).toHaveLength(3)
    expect(hook.result.current.project.lengthBeats).toBeGreaterThanOrEqual(9)

    const noteId = track?.notes[0].id
    expect(noteId).toBeDefined()
    act(() => hook.result.current.updateNote(trackId, noteId as string, { pitch: 62 }))
    track = hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(track?.notes[0].pitch).toBe(62)

    act(() => hook.result.current.setTempo(140))
    expect(hook.result.current.project.tempo).toBe(140)

    const mutedBefore = track?.muted
    act(() => hook.result.current.toggleMute(trackId))
    track = hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(track?.muted).toBe(!mutedBefore)

    const midi = hook.result.current.exportMidi()
    expect(midi).toBeInstanceOf(Uint8Array)
    expect(midi.byteLength).toBeGreaterThan(0)

    const projectFile = hook.result.current.exportProjectFile()
    const parsed = JSON.parse(projectFile) as { format: string; project: { id: string } }
    expect(parsed.format).toBe('cadence-project')
    expect(parsed.project.id).toBe(hook.result.current.project.id)

    await act(async () => {
      await hook.result.current.saveProject()
    })
    await waitFor(async () => expect(await store.list()).not.toHaveLength(0))

    const savedId = hook.result.current.project.id
    const fresh = renderComposer(store, 'contract_fresh_project')
    await act(async () => {
      await fresh.hook.result.current.loadProject(savedId)
    })
    await waitFor(() => expect(fresh.hook.result.current.project.id).toBe(savedId))
    const restoredTrack = fresh.hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(restoredTrack?.notes).toHaveLength(3)
  })

  it('round-trips persistence through a new controller over the same store seam', async () => {
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const first = renderComposer(store)
    const trackId = first.hook.result.current.selectedTrackId
    act(() => first.hook.result.current.addNoteAt(trackId, 72, 1, 1))
    await act(async () => {
      await first.hook.result.current.saveProject()
    })
    const savedId = first.hook.result.current.project.id

    const second = renderComposer(store, 'contract_second_project')
    await act(async () => {
      await second.hook.result.current.loadProject(savedId)
    })

    expect(second.hook.result.current.project.id).toBe(savedId)
    expect(second.hook.result.current.project.tracks[0].notes[0].pitch).toBe(72)
  })

  it('accepts deterministic AI suggestions through the composer insert seam', async () => {
    const provider = {
      id: 'contract-inline',
      capabilities: ['generate'],
      async generate() {
        return {
          action: 'generate',
          label: 'Two test notes',
          notes: [
            { pitch: 999, start: -1, duration: -2, velocity: 2 },
            { pitch: 64, start: 1, duration: 1, velocity: 0.5 },
          ],
        }
      },
    } satisfies CompositionAssistant

    const store = new LocalStorageProjectStore(new MemoryStorage())
    const hook = renderHook(() => {
      const composer = useComposer({
        store,
        createEngine: () => new SilentAudioEngine(),
        initialProject: createEmptyProject('contract_ai_project'),
        autosaveDelay: 0,
      })
      const assistant = useAssistant(composer, { provider })
      return { composer, assistant }
    })

    const trackId = hook.result.current.composer.selectedTrackId
    const before = hook.result.current.composer.project.tracks[0].notes.length

    act(() => hook.result.current.assistant.setAction('generate'))
    await act(async () => {
      await hook.result.current.assistant.generate()
    })
    await waitFor(() => expect(hook.result.current.assistant.suggestion).not.toBeNull())

    act(() => hook.result.current.assistant.accept())

    const notes = hook.result.current.composer.project.tracks.find((t) => t.id === trackId)?.notes
    expect(notes).toHaveLength(before + 2)
    expect(notes?.[0]).toMatchObject({ pitch: 127, start: 0, duration: 1 / 16, velocity: 1 })
    expect(notes?.[1]).toMatchObject({ pitch: 64, start: 1, duration: 1, velocity: 0.5 })
    expect(hook.result.current.assistant.suggestion).toBeNull()
  })
})
