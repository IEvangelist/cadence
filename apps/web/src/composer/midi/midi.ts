/**
 * MIDI import/export bridging the project model and Standard MIDI Files via
 * @tonejs/midi.
 *
 * Timing is driven by ticks (not seconds) so a project → .mid → project
 * round-trip preserves note positions and tempo exactly: with the header's ppq,
 * every grid-aligned beat maps to an integer tick and back without drift.
 */
import { Midi } from '@tonejs/midi'
import {
  DEFAULT_PPQ,
  DEFAULT_TEMPO,
  SCHEMA_VERSION,
  type InstrumentId,
  type Note,
  type Project,
  createNote,
  createTrack,
  newId,
} from '../model/project'

/** General MIDI percussion channel (0-based). */
const DRUM_CHANNEL = 9

const clampMidi = (value: number): number => Math.min(127, Math.max(0, Math.round(value)))

/** Serialize a project to Standard MIDI File bytes. */
export function projectToMidiBytes(project: Project): Uint8Array {
  const midi = new Midi()
  midi.header.setTempo(project.tempo)
  midi.name = project.name
  const ppq = midi.header.ppq

  for (const track of project.tracks) {
    const midiTrack = midi.addTrack()
    midiTrack.name = track.name
    if (track.instrumentId === 'drum-kit') {
      midiTrack.channel = DRUM_CHANNEL
    }
    for (const note of track.notes) {
      midiTrack.addNote({
        midi: clampMidi(note.pitch),
        ticks: Math.round(note.start * ppq),
        durationTicks: Math.max(1, Math.round(note.duration * ppq)),
        velocity: Math.min(1, Math.max(0, note.velocity)),
      })
    }
  }

  return midi.toArray()
}

function instrumentForTrack(midiTrack: {
  channel: number
  instrument: { percussion: boolean }
}): InstrumentId {
  return midiTrack.channel === DRUM_CHANNEL || midiTrack.instrument.percussion
    ? 'drum-kit'
    : 'poly-synth'
}

/** Options for {@link midiBytesToProject}. */
export interface MidiImportOptions {
  id?: string
  name?: string
}

/** Thrown when bytes cannot be parsed as a Standard MIDI File. */
export class MidiImportError extends Error {
  constructor(message = 'Could not parse the file as MIDI') {
    super(message)
    this.name = 'MidiImportError'
  }
}

/** Parse Standard MIDI File bytes into a project. */
export function midiBytesToProject(
  bytes: ArrayBuffer | Uint8Array,
  options: MidiImportOptions = {},
): Project {
  let midi: Midi
  try {
    midi = new Midi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  } catch (cause) {
    // @tonejs/midi throws synchronously on empty/truncated/non-MIDI input.
    throw new MidiImportError(cause instanceof Error ? cause.message : undefined)
  }
  // Guard against pathological headers so downstream tick math never divides by 0.
  const ppq = midi.header.ppq > 0 ? midi.header.ppq : DEFAULT_PPQ
  const tempo = midi.header.tempos[0]?.bpm
  const bpm = tempo && tempo > 0 ? Math.round(tempo) : DEFAULT_TEMPO

  let maxEnd = 0
  const tracks = midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((midiTrack, index) => {
      const notes: Note[] = midiTrack.notes.map((n) => {
        const start = n.ticks / ppq
        const duration = n.durationTicks / ppq
        maxEnd = Math.max(maxEnd, start + duration)
        return createNote(
          { pitch: n.midi, start, duration, velocity: n.velocity },
          newId('note'),
        )
      })
      return createTrack(
        {
          name: midiTrack.name || `Track ${index + 1}`,
          instrumentId: instrumentForTrack(midiTrack),
          notes,
        },
        newId('track'),
      )
    })

  if (tracks.length === 0) {
    tracks.push(createTrack({ name: 'Imported' }))
  }

  const lengthBeats = Math.max(4, Math.ceil(maxEnd / 4) * 4)

  return {
    schemaVersion: SCHEMA_VERSION,
    id: options.id ?? newId('project'),
    name: options.name ?? midi.name ?? 'Imported',
    tempo: bpm,
    ppq,
    lengthBeats,
    loop: { enabled: false, start: 0, end: lengthBeats },
    tracks,
  }
}
