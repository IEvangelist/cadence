import { describe, expect, it, vi } from 'vitest'
/* Interaction coverage: studio.plugins.example.run-command */

/** Minimal Tone mock: only what the Music Box voice constructs. */
const h = vi.hoisted(() => ({ trigger: vi.fn(), dispose: vi.fn() }))

vi.mock('tone', () => {
  class PolySynth {
    volume = { value: 0 }
    constructor(...args: unknown[]) {
      void args
    }
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.trigger(...args)
    }
    dispose() {
      h.dispose()
    }
  }
  class Synth {}
  return { PolySynth, Synth }
})

const {
  createExamplePlugin,
  insertCMajor,
  EXAMPLE_INSTRUMENT_ID,
  EXAMPLE_FORMAT_ID,
  EXAMPLE_COMMAND_ID,
} = await import('./helloPlugin')
const { validateManifest } = await import('../manifest')
const { createPluginHost } = await import('../host')
const { createEmptyProject, createNote, createTrack } = await import('../../model/project')
import type { CommandApi } from '../types'

function fakeApi(overrides: Partial<CommandApi> = {}): CommandApi {
  return {
    notify: vi.fn(),
    getProject: () => createEmptyProject('p'),
    getSelectedTrackId: () => 't1',
    insertNotes: vi.fn(),
    ...overrides,
  }
}

describe('example plugin', () => {
  it('has a valid manifest', () => {
    expect(() => validateManifest(createExamplePlugin().manifest)).not.toThrow()
  })

  it('registers all four contributions through the host', () => {
    const host = createPluginHost()
    host.use(createExamplePlugin())
    expect(host.instruments().some((i) => i.id === EXAMPLE_INSTRUMENT_ID)).toBe(true)
    expect(host.formats().some((f) => f.id === EXAMPLE_FORMAT_ID)).toBe(true)
    expect(host.commands().some((c) => c.id === EXAMPLE_COMMAND_ID)).toBe(true)
    expect(host.panels()).toHaveLength(1)
  })

  it('builds a Music Box voice that sounds', () => {
    const instrument = createExamplePlugin().contributes?.instruments?.[0]
    const track = createTrack({ instrumentId: EXAMPLE_INSTRUMENT_ID }, 't1')
    const voice = instrument!.createVoice({
      output: {} as never,
      track,
      tempo: 120,
    })
    voice.trigger(60, 0.5, 0, 0.8)
    expect(h.trigger).toHaveBeenCalledWith('C4', 0.5, 0, 0.8)
    voice.dispose()
    expect(h.dispose).toHaveBeenCalled()
  })

  it('exports a readable text summary of the project', () => {
    const project = createEmptyProject('p')
    project.name = 'Sketch'
    project.tracks = [
      createTrack(
        {
          name: 'Lead',
          instrumentId: 'poly-synth',
          notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'n1')],
        },
        't1',
      ),
    ]
    const format = createExamplePlugin().contributes?.formats?.[0]
    const text = format!.export!(project)
    expect(text).toContain('Cadence project: Sketch')
    expect(text).toContain('Track: Lead (poly-synth)')
    expect(text).toContain('C4')
  })

  it('inserts a C-major chord into the selected track', () => {
    const insertNotes = vi.fn()
    const project = createEmptyProject('p')
    project.tracks = [createTrack({}, 't1')]
    insertCMajor(fakeApi({ getProject: () => project, insertNotes }))

    expect(insertNotes).toHaveBeenCalledTimes(1)
    const [trackId, notes] = insertNotes.mock.calls[0]
    expect(trackId).toBe('t1')
    expect(notes.map((n: { pitch: number }) => n.pitch)).toEqual([60, 64, 67])
  })

  it('notifies instead of inserting when no track is selected', () => {
    const insertNotes = vi.fn()
    const notify = vi.fn()
    insertCMajor(fakeApi({ getSelectedTrackId: () => '', insertNotes, notify }))
    expect(insertNotes).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalled()
  })
})
