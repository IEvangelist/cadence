/**
 * The reference Cadence plugin — a minimal, end-to-end example.
 *
 * It exercises four extension points in one small module so plugin authors have
 * a complete, working template (see docs/plugins.md):
 *  - (a) an **instrument** — a soft "Music Box" sine voice;
 *  - (c) a **format** — a plain-text project summary exporter;
 *  - (e) a **command** — "Insert a C-major chord" into the selected track; and
 *  - (e) a **panel** — a small about/actions surface in the composer sidebar.
 *
 * It is registered (but not activated) with the default host, so it shows up in
 * the Extensions panel disabled; enabling it is what makes its contributions go
 * live. `tone` is imported `type`-only for the voice signature and required
 * lazily inside the factory, so this module pulls nothing heavy into the bundle.
 */
import * as Tone from 'tone'
import {
  type Project,
  pitchToName,
} from '../../model/project'
import type {
  CadencePlugin,
  CommandApi,
  InstrumentVoice,
  InstrumentVoiceContext,
} from '../types'

export const EXAMPLE_PLUGIN_ID = 'cadence.example.hello'
export const EXAMPLE_INSTRUMENT_ID = 'music-box'
export const EXAMPLE_FORMAT_ID = 'hello-text'
export const EXAMPLE_COMMAND_ID = 'example.insert-cmajor'
export const EXAMPLE_PANEL_ID = 'example.about'

/** A C-major triad (C4, E4, G4) — the chord the example command inserts. */
const C_MAJOR = [60, 64, 67]

function createMusicBoxVoice(context: InstrumentVoiceContext): InstrumentVoice {
  // Constructed only when the engine builds a voice, so importing this module
  // stays side-effect free (no AudioContext needed until playback).
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, release: 1.2 },
  }).connect(context.output)
  synth.volume.value = -10
  return {
    trigger: (pitch, duration, time, velocity) => {
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
    },
    dispose: () => synth.dispose(),
  }
}

/** Serialize a project as a human-readable text summary. */
export function projectToText(project: Project): string {
  const lines: string[] = [
    `Cadence project: ${project.name}`,
    `Tempo: ${project.tempo} BPM`,
    '',
  ]
  for (const track of project.tracks) {
    lines.push(`Track: ${track.name} (${track.instrumentId})`)
    if (track.notes.length === 0) lines.push('  (empty)')
    for (const note of track.notes) {
      lines.push(
        `  ${pitchToName(note.pitch)}  start ${note.start}  dur ${note.duration}  vel ${note.velocity.toFixed(2)}`,
      )
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

/** The "Insert a C-major chord" command implementation. */
export function insertCMajor(api: CommandApi): void {
  const trackId = api.getSelectedTrackId()
  if (!trackId) {
    api.notify('Select a track first to insert a C-major chord.')
    return
  }
  const track = api.getProject().tracks.find((t) => t.id === trackId)
  const start = track
    ? track.notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0)
    : 0
  api.insertNotes(
    trackId,
    C_MAJOR.map((pitch) => ({ pitch, start, duration: 1, velocity: 0.8 })),
  )
  api.notify('Inserted a C-major chord.')
}

/** Build the example plugin. */
export function createExamplePlugin(): CadencePlugin {
  return {
    manifest: {
      id: EXAMPLE_PLUGIN_ID,
      name: 'Hello Cadence (example)',
      version: '1.0.0',
      description: 'A reference plugin: a Music Box instrument, a text exporter, and a chord command.',
      author: 'Cadence',
    },
    contributes: {
      instruments: [
        {
          id: EXAMPLE_INSTRUMENT_ID,
          name: 'Music Box',
          kind: 'synth',
          description: 'A soft sine voice with a gentle bell-like release.',
          polyphonic: true,
          createVoice: createMusicBoxVoice,
        },
      ],
      formats: [
        {
          id: EXAMPLE_FORMAT_ID,
          name: 'Text summary (.txt)',
          extension: '.txt',
          mimeType: 'text/plain',
          export: (project) => projectToText(project),
        },
      ],
      commands: [
        {
          id: EXAMPLE_COMMAND_ID,
          title: 'Insert a C-major chord',
          keybinding: 'mod+shift+h',
          run: insertCMajor,
        },
      ],
      panels: [
        {
          id: EXAMPLE_PANEL_ID,
          title: 'Example plugin',
          render: (context) => (
            <div className="example-plugin-panel">
              <p className="plugin-desc">
                This example plugin adds the Music Box instrument, a text exporter, and the
                command below.
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => context.runCommand(EXAMPLE_COMMAND_ID)}
              >
                Insert a C-major chord
              </button>
            </div>
          ),
        },
      ],
    },
  }
}
