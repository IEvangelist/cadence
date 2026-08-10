import { describe, expect, it } from 'vitest'
import { analyzeMastering, computeMixMetrics, deriveMasteringSuggestion } from './mastering'
import { createEmptyProject, createNote, createTrack } from '../../model/project'
import type { Project } from '../../model/project'

function projectWith(notes: Array<{ pitch: number; start: number; duration?: number; velocity?: number }>, muted = false): Project {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      { name: 'T', muted, notes: notes.map((n, i) => createNote(n, `n${i}`)) },
      't1',
    ),
  ]
  return project
}

describe('computeMixMetrics', () => {
  it('reports zeros for a project with no notes', () => {
    const metrics = computeMixMetrics(createEmptyProject('p'))
    expect(metrics.noteCount).toBe(0)
    expect(metrics.averageVelocity).toBe(0)
    expect(metrics.maxConcurrent).toBe(0)
    expect(metrics.lowEndShare).toBe(0)
  })

  it('computes level, range, pitch bounds and low-end share', () => {
    const metrics = computeMixMetrics(
      projectWith([
        { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
        { pitch: 72, start: 1, duration: 1, velocity: 0.4 },
      ]),
    )
    expect(metrics.trackCount).toBe(1)
    expect(metrics.noteCount).toBe(2)
    expect(metrics.averageVelocity).toBe(0.6)
    expect(metrics.peakVelocity).toBe(0.8)
    expect(metrics.dynamicRange).toBeCloseTo(0.4, 10)
    expect(metrics.lowestPitch).toBe(60)
    expect(metrics.highestPitch).toBe(72)
    expect(metrics.maxConcurrent).toBe(1) // touching notes don't overlap
    expect(metrics.lowEndShare).toBe(0)
  })

  it('counts overlapping notes as concurrent', () => {
    const metrics = computeMixMetrics(
      projectWith([
        { pitch: 60, start: 0, duration: 2, velocity: 0.7 },
        { pitch: 64, start: 1, duration: 2, velocity: 0.7 },
      ]),
    )
    expect(metrics.maxConcurrent).toBe(2)
  })

  it('excludes muted tracks', () => {
    const metrics = computeMixMetrics(
      projectWith([{ pitch: 60, start: 0, duration: 1, velocity: 0.8 }], true),
    )
    expect(metrics.trackCount).toBe(0)
    expect(metrics.noteCount).toBe(0)
  })

  it('measures low-end share below C3', () => {
    const metrics = computeMixMetrics(
      projectWith([
        { pitch: 40, start: 0, duration: 1, velocity: 0.7 },
        { pitch: 42, start: 1, duration: 1, velocity: 0.7 },
        { pitch: 72, start: 2, duration: 1, velocity: 0.7 },
      ]),
    )
    expect(metrics.lowEndShare).toBeCloseTo(0.67, 2)
  })
})

describe('analyzeMastering', () => {
  it('flags an empty project with an info advisory', () => {
    const report = analyzeMastering(createEmptyProject('p'))
    expect(report.advisories).toHaveLength(1)
    expect(report.advisories[0].id).toBe('empty')
    expect(report.summary).toMatch(/no notes/i)
  })

  it('warns about headroom when peaks are near maximum', () => {
    const report = analyzeMastering(
      projectWith([{ pitch: 60, start: 0, duration: 1, velocity: 0.98 }]),
    )
    expect(report.advisories.some((s) => s.id === 'headroom' && s.severity === 'warning')).toBe(true)
  })

  it('suggests trimming a hot average level', () => {
    const report = analyzeMastering(
      projectWith([
        { pitch: 60, start: 0, duration: 1, velocity: 0.9 },
        { pitch: 62, start: 1, duration: 1, velocity: 0.88 },
      ]),
    )
    expect(report.advisories.some((s) => s.id === 'loud')).toBe(true)
  })

  it('suggests raising a quiet mix', () => {
    const report = analyzeMastering(
      projectWith([
        { pitch: 60, start: 0, duration: 1, velocity: 0.2 },
        { pitch: 62, start: 1, duration: 1, velocity: 0.2 },
      ]),
    )
    expect(report.advisories.some((s) => s.id === 'quiet')).toBe(true)
  })

  it('suggests adding dynamics when velocities are flat', () => {
    const flat = Array.from({ length: 5 }, (_, i) => ({
      pitch: 60,
      start: i,
      duration: 1,
      velocity: 0.5,
    }))
    const report = analyzeMastering(projectWith(flat))
    expect(report.advisories.some((s) => s.id === 'dynamics')).toBe(true)
  })

  it('warns about dense polyphony', () => {
    const stack = Array.from({ length: 6 }, (_, i) => ({
      pitch: 60 + i,
      start: 0,
      duration: 1,
      velocity: 0.4 + i * 0.08,
    }))
    const report = analyzeMastering(projectWith(stack))
    expect(report.advisories.some((s) => s.id === 'polyphony')).toBe(true)
  })

  it('flags low-end build-up', () => {
    const report = analyzeMastering(
      projectWith([
        { pitch: 36, start: 0, duration: 1, velocity: 0.6 },
        { pitch: 38, start: 1, duration: 1, velocity: 0.6 },
        { pitch: 40, start: 2, duration: 1, velocity: 0.6 },
      ]),
    )
    expect(report.advisories.some((s) => s.id === 'lowend')).toBe(true)
  })

  it('reports a balanced mix when nothing stands out', () => {
    const report = analyzeMastering(
      projectWith([
        { pitch: 60, start: 0, duration: 1, velocity: 0.5 },
        { pitch: 64, start: 1, duration: 1, velocity: 0.62 },
        { pitch: 67, start: 2, duration: 1, velocity: 0.72 },
      ]),
    )
    expect(report.advisories).toHaveLength(1)
    expect(report.advisories[0].id).toBe('balanced')
    expect(report.summary).toMatch(/suggestion/i)
  })

  it('emits a contract mastering directive alongside the advisories', () => {
    const report = analyzeMastering(
      projectWith([{ pitch: 60, start: 0, duration: 1, velocity: 0.98 }]),
    )
    expect(typeof report.suggestion.masterGainDb).toBe('number')
    expect(typeof report.suggestion.limiterThresholdDb).toBe('number')
    expect(report.suggestion.perTrackGainDb).toBeTypeOf('object')
    expect(report.suggestion.rationale).toMatch(/\S/)
  })
})

describe('deriveMasteringSuggestion (contract directive)', () => {
  it('emits a neutral directive for an empty project', () => {
    const project = createEmptyProject('p')
    const suggestion = deriveMasteringSuggestion(project, computeMixMetrics(project))
    expect(suggestion.masterGainDb).toBe(0)
    expect(suggestion.limiterThresholdDb).toBe(0)
    expect(suggestion.perTrackGainDb).toEqual({})
    expect(suggestion.rationale).toMatch(/no notes/i)
  })

  it('pulls the master down and tightens the limiter when peaks run hot', () => {
    const project = projectWith([{ pitch: 60, start: 0, duration: 1, velocity: 0.98 }])
    const suggestion = deriveMasteringSuggestion(project, computeMixMetrics(project))
    expect(suggestion.masterGainDb).toBeLessThan(0)
    expect(suggestion.limiterThresholdDb).toBe(-2)
  })

  it('boosts a quiet mix and keeps a −1 dB ceiling', () => {
    const project = projectWith([
      { pitch: 60, start: 0, duration: 1, velocity: 0.2 },
      { pitch: 62, start: 1, duration: 1, velocity: 0.2 },
    ])
    const suggestion = deriveMasteringSuggestion(project, computeMixMetrics(project))
    expect(suggestion.masterGainDb).toBeGreaterThan(0)
    expect(suggestion.limiterThresholdDb).toBe(-1)
  })

  it('balances louder and quieter tracks toward the mix average', () => {
    const project = createEmptyProject('p')
    project.tracks = [
      createTrack({ name: 'Loud', notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.9 }, 'a0')] }, 'loud'),
      createTrack({ name: 'Quiet', notes: [createNote({ pitch: 48, start: 0, duration: 1, velocity: 0.3 }, 'b0')] }, 'quiet'),
    ]
    const suggestion = deriveMasteringSuggestion(project, computeMixMetrics(project))
    expect(suggestion.perTrackGainDb.loud).toBeLessThan(0)
    expect(suggestion.perTrackGainDb.quiet).toBeGreaterThan(0)
  })

  it('excludes muted and empty tracks from the per-track directive', () => {
    const project = createEmptyProject('p')
    project.tracks = [
      createTrack({ name: 'Audible', notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.6 }, 'a0')] }, 'audible'),
      createTrack({ name: 'Muted', muted: true, notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.6 }, 'm0')] }, 'muted'),
      createTrack({ name: 'Empty', notes: [] }, 'empty'),
    ]
    const suggestion = deriveMasteringSuggestion(project, computeMixMetrics(project))
    expect(Object.keys(suggestion.perTrackGainDb)).toEqual(['audible'])
  })
})
