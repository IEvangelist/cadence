/**
 * AI auto-mastering suggestions.
 *
 * A read-only analysis pass that inspects the project's notes and produces
 * plain-language mastering advice — level balance, dynamic range, low-end
 * build-up, and polyphony/headroom. It deliberately works on the *symbolic*
 * score (pitches, velocities, timing), not rendered audio, so it is instant,
 * deterministic and runs with zero dependencies. Pro-tier feature.
 *
 * The output is advisory: it never mutates the project. The composer surfaces
 * the suggestions; the musician decides what to act on.
 */
import type { Project } from '../../model/project'
import type {
  MasteringAdvisory,
  MasteringReport,
  MasteringSuggestion,
  MixMetrics,
} from './types'

/** MIDI pitch below which a note is considered "low end" (below C3). */
const BASS_THRESHOLD = 48

const round2 = (value: number): number => Math.round(value * 100) / 100

/** Compute the max number of notes sounding at once across all tracks. */
function computeMaxConcurrent(
  events: Array<{ start: number; end: number }>,
): number {
  if (events.length === 0) return 0
  // Sweep-line over note on/off boundaries.
  const points: Array<{ time: number; delta: number }> = []
  for (const event of events) {
    points.push({ time: event.start, delta: 1 })
    points.push({ time: event.end, delta: -1 })
  }
  // Process offs before ons at the same instant so touching notes don't overlap.
  points.sort((a, b) => a.time - b.time || a.delta - b.delta)
  let current = 0
  let peak = 0
  for (const point of points) {
    current += point.delta
    if (current > peak) peak = current
  }
  return peak
}

/** Derive the numeric {@link MixMetrics} for a project (unmuted tracks only). */
export function computeMixMetrics(project: Project): MixMetrics {
  const tracks = project.tracks.filter((track) => !track.muted)
  const velocities: number[] = []
  const pitches: number[] = []
  const events: Array<{ start: number; end: number }> = []
  let lowEndCount = 0

  for (const track of tracks) {
    for (const note of track.notes) {
      velocities.push(note.velocity)
      pitches.push(note.pitch)
      events.push({ start: note.start, end: note.start + note.duration })
      if (note.pitch < BASS_THRESHOLD) lowEndCount += 1
    }
  }

  const noteCount = velocities.length
  const averageVelocity =
    noteCount > 0 ? velocities.reduce((sum, v) => sum + v, 0) / noteCount : 0
  const peakVelocity = noteCount > 0 ? Math.max(...velocities) : 0
  const minVelocity = noteCount > 0 ? Math.min(...velocities) : 0

  return {
    trackCount: tracks.length,
    noteCount,
    averageVelocity: round2(averageVelocity),
    peakVelocity: round2(peakVelocity),
    dynamicRange: round2(peakVelocity - minVelocity),
    lowestPitch: noteCount > 0 ? Math.min(...pitches) : 0,
    highestPitch: noteCount > 0 ? Math.max(...pitches) : 0,
    maxConcurrent: computeMaxConcurrent(events),
    lowEndShare: noteCount > 0 ? round2(lowEndCount / noteCount) : 0,
  }
}

/** Turn metrics into ordered, human-readable advisories. */
function deriveAdvisories(metrics: MixMetrics): MasteringAdvisory[] {
  const advisories: MasteringAdvisory[] = []
  const add = (
    id: string,
    title: string,
    detail: string,
    severity: MasteringAdvisory['severity'],
  ): void => {
    advisories.push({ id, title, detail, severity })
  }

  if (metrics.noteCount === 0) {
    add('empty', 'Nothing to master yet', 'Add some notes, then run the analysis again for level and balance advice.', 'info')
    return advisories
  }

  if (metrics.peakVelocity > 0.95) {
    add('headroom', 'Leave some headroom', 'Peaks are near maximum. Lower the loudest notes a little or pull the master down ~2 dB to avoid clipping.', 'warning')
  }
  if (metrics.averageVelocity > 0.85) {
    add('loud', 'Overall level is hot', 'Average velocity is very high — consider gentle compression or trimming levels so the mix can breathe.', 'suggestion')
  } else if (metrics.averageVelocity < 0.3) {
    add('quiet', 'Mix is quite quiet', 'Average velocity is low. Raise levels or normalize so the piece reaches a healthy loudness.', 'suggestion')
  }

  if (metrics.dynamicRange < 0.1 && metrics.noteCount > 4) {
    add('dynamics', 'Add dynamic contrast', 'Velocities are nearly flat. Vary note velocities to give the performance light and shade.', 'suggestion')
  }

  if (metrics.maxConcurrent >= 6) {
    add('polyphony', 'Dense polyphony', `Up to ${metrics.maxConcurrent} notes sound at once. Thin busy sections or balance track levels to keep the low end clean.`, 'warning')
  }

  if (metrics.lowEndShare > 0.5) {
    add('lowend', 'Low-end build-up', 'More than half the notes sit in the bass register. Consider a high-pass on non-bass parts or spreading voices higher.', 'suggestion')
  }

  if (advisories.length === 0) {
    add('balanced', 'Mix looks balanced', 'Levels, dynamics and range look healthy. Do a final listen for anything the numbers can’t catch.', 'info')
  }

  return advisories
}

/** Amplitude floor so a silent/near-silent level maps to a finite dB value. */
const MIN_AMPLITUDE = 0.02
/** Target master peak: leave ~1 dB of headroom below full scale. */
const TARGET_PEAK_DB = -1
/** Clamp bounds (dB) that keep the emitted gains musical. */
const MASTER_GAIN_LIMIT = 12
const TRACK_GAIN_LIMIT = 6

/** Convert a 0–1 amplitude proxy (normalized velocity) to a symbolic dB value. */
const toDb = (amplitude: number): number =>
  20 * Math.log10(Math.max(amplitude, MIN_AMPLITUDE))

/** Clamp to ±limit and round to one decimal place. */
const clampRound1 = (value: number, limit: number): number => {
  const clamped = Math.min(limit, Math.max(-limit, value))
  return Math.round(clamped * 10) / 10
}

/**
 * Derive the contract {@link MasteringSuggestion} — the mixer-overlay directive —
 * from the symbolic mix. Master gain aims peaks at {@link TARGET_PEAK_DB}; the
 * limiter ceiling tightens when peaks run hot; per-track gains nudge each unmuted
 * track toward the overall average level. Every value is symbolic (derived from
 * note velocities), never from rendered audio, and targets `contract/mixing.ts`.
 */
export function deriveMasteringSuggestion(
  project: Project,
  metrics: MixMetrics,
): MasteringSuggestion {
  if (metrics.noteCount === 0) {
    return {
      masterGainDb: 0,
      limiterThresholdDb: 0,
      perTrackGainDb: {},
      rationale: 'No notes to master yet — add some, then analyze again.',
    }
  }

  const masterGainDb = clampRound1(TARGET_PEAK_DB - toDb(metrics.peakVelocity), MASTER_GAIN_LIMIT)
  const limiterThresholdDb = metrics.peakVelocity > 0.95 ? -2 : -1

  const perTrackGainDb: Record<string, number> = {}
  for (const track of project.tracks) {
    if (track.muted || track.notes.length === 0) continue
    const trackAvg =
      track.notes.reduce((sum, note) => sum + note.velocity, 0) / track.notes.length
    if (trackAvg <= 0) continue
    perTrackGainDb[track.id] = clampRound1(
      toDb(metrics.averageVelocity / trackAvg),
      TRACK_GAIN_LIMIT,
    )
  }

  const moves: string[] = []
  if (masterGainDb !== 0) {
    moves.push(`${masterGainDb > 0 ? 'raise' : 'lower'} the master ${Math.abs(masterGainDb)} dB`)
  }
  moves.push(`set the limiter ceiling to ${limiterThresholdDb} dB`)
  const balanced = Object.keys(perTrackGainDb).length
  if (balanced > 0) {
    moves.push(`balance ${balanced} track${balanced === 1 ? '' : 's'} toward the mix average`)
  }
  const sentence = moves.join(', ')
  const rationale = `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`

  return { masterGainDb, limiterThresholdDb, perTrackGainDb, rationale }
}

/** Produce the full mastering report for a project. */
export function analyzeMastering(project: Project): MasteringReport {
  const metrics = computeMixMetrics(project)
  const suggestion = deriveMasteringSuggestion(project, metrics)
  const advisories = deriveAdvisories(metrics)
  const summary =
    metrics.noteCount === 0
      ? 'No notes to analyze yet.'
      : `${metrics.trackCount} track${metrics.trackCount === 1 ? '' : 's'}, ${metrics.noteCount} notes · avg level ${(metrics.averageVelocity * 100).toFixed(0)}% · ${advisories.length} suggestion${advisories.length === 1 ? '' : 's'}.`
  return { metrics, suggestion, advisories, summary }
}
