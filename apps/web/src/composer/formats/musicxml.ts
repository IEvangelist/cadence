/**
 * MusicXML import/export — a focused `score-partwise` subset for notation
 * interchange with DAWs and notation apps (MuseScore, Finale, Sibelius, Dorico).
 *
 * There is no well-maintained JavaScript library that *authors* MusicXML (the
 * popular ones — OpenSheetMusicDisplay, VexFlow — only render), so this module
 * hand-writes a deliberately small, standard-conformant subset:
 *
 *  - One `<part>` per track, in a fixed 4/4 meter.
 *  - A single `<divisions>` resolution so every grid-aligned beat maps to an
 *    integer duration and back without drift.
 *  - Notes are positioned inside measures with `<backup>`/`<forward>` cursor
 *    moves (handling chords, gaps, and polyphony uniformly), and any note that
 *    crosses a barline is split into tied segments — exactly how MuseScore &c.
 *    emit MusicXML. Import inverts this with the same cursor arithmetic and
 *    merges tied segments back into whole notes.
 *
 * A project → MusicXML → project round-trip preserves pitch, start, duration and
 * tempo. MusicXML is a *notation* format and carries no performance velocity, so
 * velocity is restored to the model default on import (documented in docs/share.md).
 */
import {
  BEATS_PER_BAR,
  DEFAULT_TEMPO,
  SCHEMA_VERSION,
  type InstrumentId,
  type Note,
  type Project,
  createNote,
  createTrack,
  newId,
} from '../model/project'
import { migrateProject } from '../model/persistence'

/** Divisions per quarter note written to the file (also our tick resolution). */
const DIVISIONS = 480

/** Divisions in one 4/4 measure. */
const MEASURE_DIVISIONS = DIVISIONS * BEATS_PER_BAR

/** Thrown when a string cannot be parsed as the MusicXML subset we read. */
export class MusicXmlImportError extends Error {
  constructor(message = 'Could not parse the file as MusicXML') {
    super(message)
    this.name = 'MusicXmlImportError'
  }
}

// ---------------------------------------------------------------------------
// Pitch <-> step/alter/octave
// ---------------------------------------------------------------------------

interface Spelling {
  step: string
  alter: number
}

/** Sharp spelling for each pitch class (0 = C). */
const PITCH_CLASS_SPELLING: Spelling[] = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
]

/** Semitone offset above C for each diatonic step. */
const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

function midiToSpelling(midi: number): Spelling & { octave: number } {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  const spelling = PITCH_CLASS_SPELLING[pc]
  return { ...spelling, octave }
}

function spellingToMidi(step: string, alter: number, octave: number): number {
  const base = STEP_SEMITONES[step.toUpperCase()] ?? 0
  return (octave + 1) * 12 + base + alter
}

/** Coarse `<type>` for nicer notation; not required for round-trip. */
function noteType(durationBeats: number): string {
  if (durationBeats >= 4) return 'whole'
  if (durationBeats >= 2) return 'half'
  if (durationBeats >= 1) return 'quarter'
  if (durationBeats >= 0.5) return 'eighth'
  if (durationBeats >= 0.25) return '16th'
  return '32nd'
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

interface Segment {
  measure: number
  startInMeasure: number // divisions from the measure start
  duration: number // divisions
  pitch: number
  tieStart: boolean
  tieStop: boolean
}

/** Split a note into per-measure segments, tying across barlines. */
function segmentsForNote(note: Note): Segment[] {
  const segments: Segment[] = []
  const totalStart = note.start
  const totalEnd = note.start + note.duration
  let cursor = totalStart
  let measure = Math.floor(cursor / BEATS_PER_BAR)

  while (cursor < totalEnd - 1e-9) {
    const measureEndBeats = (measure + 1) * BEATS_PER_BAR
    const segEnd = Math.min(totalEnd, measureEndBeats)
    segments.push({
      measure,
      startInMeasure: Math.round((cursor - measure * BEATS_PER_BAR) * DIVISIONS),
      duration: Math.round((segEnd - cursor) * DIVISIONS),
      pitch: note.pitch,
      tieStart: segEnd < totalEnd - 1e-9,
      tieStop: cursor > totalStart + 1e-9,
    })
    cursor = segEnd
    measure += 1
  }
  return segments
}

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function noteXml(segment: Segment): string {
  const { step, alter, octave } = midiToSpelling(segment.pitch)
  const parts: string[] = ['      <note>']
  parts.push('        <pitch>')
  parts.push(`          <step>${step}</step>`)
  if (alter !== 0) parts.push(`          <alter>${alter}</alter>`)
  parts.push(`          <octave>${octave}</octave>`)
  parts.push('        </pitch>')
  parts.push(`        <duration>${segment.duration}</duration>`)
  if (segment.tieStop) parts.push('        <tie type="stop"/>')
  if (segment.tieStart) parts.push('        <tie type="start"/>')
  parts.push('        <voice>1</voice>')
  parts.push(`        <type>${noteType(segment.duration / DIVISIONS)}</type>`)
  if (segment.tieStop || segment.tieStart) {
    parts.push('        <notations>')
    if (segment.tieStop) parts.push('          <tied type="stop"/>')
    if (segment.tieStart) parts.push('          <tied type="start"/>')
    parts.push('        </notations>')
  }
  parts.push('      </note>')
  return parts.join('\n')
}

function restXml(duration: number, full: boolean): string {
  return [
    '      <note>',
    full ? '        <rest measure="yes"/>' : '        <rest/>',
    `        <duration>${duration}</duration>`,
    '        <voice>1</voice>',
    '      </note>',
  ].join('\n')
}

const forwardXml = (duration: number): string =>
  `      <forward>\n        <duration>${duration}</duration>\n      </forward>`

const backupXml = (duration: number): string =>
  `      <backup>\n        <duration>${duration}</duration>\n      </backup>`

function measureXml(
  index: number,
  segments: Segment[],
  attributes: string | null,
  direction: string | null,
): string {
  const lines: string[] = [`    <measure number="${index + 1}">`]
  if (attributes) lines.push(attributes)
  if (direction) lines.push(direction)

  if (segments.length === 0) {
    lines.push(restXml(MEASURE_DIVISIONS, true))
  } else {
    const sorted = [...segments].sort(
      (a, b) => a.startInMeasure - b.startInMeasure || b.pitch - a.pitch,
    )
    let cursor = 0
    let maxReached = 0
    for (const segment of sorted) {
      const delta = segment.startInMeasure - cursor
      if (delta > 0) lines.push(forwardXml(delta))
      else if (delta < 0) lines.push(backupXml(-delta))
      cursor = segment.startInMeasure
      lines.push(noteXml(segment))
      cursor += segment.duration
      maxReached = Math.max(maxReached, cursor)
    }
    // Fill to the barline so the measure's total duration is well-formed.
    const fill = MEASURE_DIVISIONS - cursor
    if (fill > 0) lines.push(forwardXml(fill))
    else if (fill < 0) lines.push(backupXml(-fill))
  }

  lines.push('    </measure>')
  return lines.join('\n')
}

function attributesXml(): string {
  return [
    '      <attributes>',
    `        <divisions>${DIVISIONS}</divisions>`,
    '        <key><fifths>0</fifths></key>',
    `        <time><beats>${BEATS_PER_BAR}</beats><beat-type>4</beat-type></time>`,
    '        <clef><sign>G</sign><line>2</line></clef>',
    '      </attributes>',
  ].join('\n')
}

function tempoDirectionXml(tempo: number): string {
  return [
    '      <direction placement="above">',
    '        <direction-type>',
    '          <metronome>',
    '            <beat-unit>quarter</beat-unit>',
    `            <per-minute>${tempo}</per-minute>`,
    '          </metronome>',
    '        </direction-type>',
    `        <sound tempo="${tempo}"/>`,
    '      </direction>',
  ].join('\n')
}

/** Serialize a project to a MusicXML `score-partwise` document string. */
export function projectToMusicXml(project: Project): string {
  const measureCount = Math.max(
    1,
    Math.ceil(project.lengthBeats / BEATS_PER_BAR),
    ...project.tracks.flatMap((track) =>
      track.notes.map((n) => Math.ceil((n.start + n.duration) / BEATS_PER_BAR)),
    ),
  )

  const partListItems: string[] = []
  const partBodies: string[] = []

  project.tracks.forEach((track, trackIndex) => {
    const partId = `P${trackIndex + 1}`
    partListItems.push(
      [
        `    <score-part id="${partId}">`,
        `      <part-name>${xmlEscape(track.name)}</part-name>`,
        '    </score-part>',
      ].join('\n'),
    )

    const byMeasure = new Map<number, Segment[]>()
    for (const note of track.notes) {
      for (const segment of segmentsForNote(note)) {
        const bucket = byMeasure.get(segment.measure) ?? []
        bucket.push(segment)
        byMeasure.set(segment.measure, bucket)
      }
    }

    const measures: string[] = []
    for (let m = 0; m < measureCount; m += 1) {
      measures.push(
        measureXml(
          m,
          byMeasure.get(m) ?? [],
          m === 0 ? attributesXml() : null,
          m === 0 ? tempoDirectionXml(project.tempo) : null,
        ),
      )
    }

    partBodies.push(
      [`  <part id="${partId}">`, ...measures, '  </part>'].join('\n'),
    )
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    '  <work>',
    `    <work-title>${xmlEscape(project.name)}</work-title>`,
    '  </work>',
    '  <part-list>',
    ...partListItems,
    '  </part-list>',
    ...partBodies,
    '</score-partwise>',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Options for {@link musicXmlToProject}. */
export interface MusicXmlImportOptions {
  id?: string
  name?: string
}

interface ImportedSegment {
  pitch: number
  start: number // beats
  duration: number // beats
  tieStart: boolean
  tieStop: boolean
}

function textOf(el: Element | null, selector: string): string | null {
  const found = el?.querySelector(selector)
  return found?.textContent?.trim() ?? null
}

function numberOf(el: Element | null, selector: string, fallback: number): number {
  const raw = textOf(el, selector)
  const value = raw === null ? NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/**
 * Read a `<duration>` in divisions as a finite, non-negative number. Malformed or
 * missing content coerces to 0 so a single bad note can't poison the measure
 * cursor (and thus every following note's start) with NaN.
 */
function durationDivisions(el: Element): number {
  const value = numberOf(el, 'duration', 0)
  return value >= 0 ? value : 0
}

function parseDocument(xml: string): Document {
  if (typeof DOMParser === 'undefined') {
    throw new MusicXmlImportError('XML parsing is not available in this environment')
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || !doc.querySelector('score-partwise')) {
    throw new MusicXmlImportError()
  }
  return doc
}

/** Merge contiguous tied segments of the same pitch back into whole notes. */
function mergeTies(segments: ImportedSegment[]): ImportedSegment[] {
  const sorted = [...segments].sort(
    (a, b) => a.pitch - b.pitch || a.start - b.start,
  )
  const merged: ImportedSegment[] = []
  for (const segment of sorted) {
    const prev = merged[merged.length - 1]
    const contiguous =
      prev &&
      prev.pitch === segment.pitch &&
      prev.tieStart &&
      segment.tieStop &&
      Math.abs(prev.start + prev.duration - segment.start) < 1e-6
    if (contiguous) {
      prev.duration += segment.duration
      prev.tieStart = segment.tieStart
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

function readTempo(doc: Document): number {
  const sound = doc.querySelector('sound[tempo]')
  const soundTempo = sound ? Number(sound.getAttribute('tempo')) : NaN
  if (Number.isFinite(soundTempo) && soundTempo > 0) return Math.round(soundTempo)
  const perMinute = doc.querySelector('metronome per-minute')
  const metronome = perMinute ? Number(perMinute.textContent) : NaN
  if (Number.isFinite(metronome) && metronome > 0) return Math.round(metronome)
  return DEFAULT_TEMPO
}

function instrumentForPart(name: string): InstrumentId {
  return /drum|perc|beat|kit/i.test(name) ? 'drum-kit' : 'poly-synth'
}

function segmentsFromPart(part: Element, divisions: number): ImportedSegment[] {
  const segments: ImportedSegment[] = []
  const measures = Array.from(part.querySelectorAll('measure'))
  let measureStart = 0 // beats

  for (const measure of measures) {
    let cursor = 0 // divisions from measure start
    for (const child of Array.from(measure.children)) {
      const tag = child.tagName.toLowerCase()
      if (tag === 'note') {
        const duration = durationDivisions(child)
        const isRest = child.querySelector('rest') !== null
        if (!isRest) {
          const step = textOf(child, 'pitch step')
          const octave = numberOf(child, 'pitch octave', 4)
          const alter = numberOf(child, 'pitch alter', 0)
          if (step) {
            const ties = Array.from(child.querySelectorAll('tie')).map((t) =>
              t.getAttribute('type'),
            )
            segments.push({
              pitch: spellingToMidi(step, alter, octave),
              start: measureStart + cursor / divisions,
              duration: duration / divisions,
              tieStart: ties.includes('start'),
              tieStop: ties.includes('stop'),
            })
          }
        }
        // A `<chord/>` note shares the previous note's start; only advance the
        // cursor for non-chord notes.
        if (child.querySelector('chord') === null) cursor += duration
      } else if (tag === 'forward') {
        cursor += durationDivisions(child)
      } else if (tag === 'backup') {
        cursor -= durationDivisions(child)
      }
    }
    measureStart += MEASURE_DIVISIONS / divisions
  }

  return mergeTies(segments)
}

/** Parse a MusicXML `score-partwise` document into a project. */
export function musicXmlToProject(
  xml: string,
  options: MusicXmlImportOptions = {},
): Project {
  const doc = parseDocument(xml)
  const divisionsText = doc.querySelector('divisions')?.textContent
  const parsedDivisions = divisionsText ? Number(divisionsText) : NaN
  const divisions =
    Number.isFinite(parsedDivisions) && parsedDivisions > 0 ? parsedDivisions : DIVISIONS

  const tempo = readTempo(doc)
  const scoreParts = new Map<string, string>()
  for (const scorePart of Array.from(doc.querySelectorAll('part-list score-part'))) {
    const id = scorePart.getAttribute('id') ?? ''
    scoreParts.set(id, textOf(scorePart, 'part-name') ?? id)
  }

  let maxEnd = 0
  const tracks = Array.from(doc.querySelectorAll('score-partwise > part')).map(
    (part, index) => {
      const partId = part.getAttribute('id') ?? ''
      const name = scoreParts.get(partId) ?? `Track ${index + 1}`
      const notes: Note[] = segmentsFromPart(part, divisions).map((segment) => {
        maxEnd = Math.max(maxEnd, segment.start + segment.duration)
        return createNote(
          {
            pitch: Math.round(segment.pitch),
            start: segment.start,
            duration: segment.duration,
          },
          newId('note'),
        )
      })
      return createTrack(
        { name, instrumentId: instrumentForPart(name), notes },
        newId('track'),
      )
    },
  )

  if (tracks.length === 0) tracks.push(createTrack({ name: 'Imported' }))

  const lengthBeats = Math.max(
    BEATS_PER_BAR,
    Math.ceil(maxEnd / BEATS_PER_BAR) * BEATS_PER_BAR,
  )

  const workTitle = doc.querySelector('work-title')?.textContent?.trim() || null

  // Route the assembled project through the same migrate/sanitize seam used by
  // the portable-file and share importers, so malformed numeric content in an
  // otherwise-parseable score (bad/missing durations, out-of-range pitches,
  // negative starts from a backup>forward) is clamped instead of injecting
  // NaN/negative/out-of-range values into live state.
  return migrateProject({
    schemaVersion: SCHEMA_VERSION,
    id: options.id ?? newId('project'),
    name: options.name ?? workTitle ?? 'Imported',
    tempo,
    ppq: DIVISIONS,
    lengthBeats,
    loop: { enabled: false, start: 0, end: lengthBeats },
    tracks,
  })
}
