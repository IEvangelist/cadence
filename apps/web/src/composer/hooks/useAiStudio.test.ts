import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAiStudio } from './useAiStudio'
import { MOTIF_LENGTH_RANGE } from '../ai/expanded'
import { createEmptyProject, createNote, createTrack } from '../model/project'
import type { Note, Project } from '../model/project'
import type { ComposerController } from './useComposer'
import type { Entitlements } from '../../billing/entitlementsClient'

function proEntitlements(): Entitlements {
  return {
    tier: 'Pro',
    watermarkExports: false,
    maxProjects: 100,
    aiGenerationsPerDay: -1,
    advancedFormats: true,
    stemSeparation: true,
    collaborationSeats: 5,
  }
}

function projectWithNotes(): Project {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      {
        name: 'Lead',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'n0'),
          createNote({ pitch: 62, start: 0.5, duration: 0.5, velocity: 0.6 }, 'n1'),
          createNote({ pitch: 64, start: 1, duration: 1, velocity: 0.7 }, 'n2'),
        ],
      },
      't1',
    ),
  ]
  return project
}

interface Harness {
  controller: ComposerController
  inserts: Array<{ trackId: string; notes: Array<{ pitch: number; start: number; duration: number; velocity: number }> }>
  updates: Array<{ trackId: string; noteId: string; changes: Partial<Note> }>
  notifications: string[]
}

/** A minimal fake controller exposing only the public surface useAiStudio uses. */
function harness(project: Project): Harness {
  const inserts: Harness['inserts'] = []
  const updates: Harness['updates'] = []
  const notifications: string[] = []
  const controller = {
    project,
    selectedTrackId: project.tracks[0]?.id ?? '',
    insertNotes: (trackId: string, notes: Harness['inserts'][number]['notes']) => {
      inserts.push({ trackId, notes })
    },
    updateNote: (trackId: string, noteId: string, changes: Partial<Note>) => {
      updates.push({ trackId, noteId, changes })
    },
    notify: (message: string) => {
      notifications.push(message)
    },
  } as unknown as ComposerController
  return { controller, inserts, updates, notifications }
}

describe('useAiStudio', () => {
  it('resolves free capabilities from null entitlements', () => {
    const { controller } = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(controller, { entitlements: null }))
    expect(result.current.unlimited).toBe(false)
    expect(result.current.canUse('text-to-motif')).toBe(true)
    expect(result.current.canUse('groove')).toBe(true)
    expect(result.current.canUse('style-transfer')).toBe(false)
    expect(result.current.canUse('auto-master')).toBe(false)
  })

  it('inserts a generated motif through the controller', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: null }))
    act(() => result.current.setPrompt('a calm ambient idea'))
    act(() => result.current.createMotif())
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0].trackId).toBe('t1')
    expect(h.inserts[0].notes.length).toBeGreaterThan(0)
    expect(result.current.status).toMatch(/motif/i)
  })

  it('places the motif after existing notes on the track', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: null }))
    act(() => result.current.createMotif())
    // Existing notes end at beat 2, so the motif must start at or after 2.
    for (const note of h.inserts[0].notes) expect(note.start).toBeGreaterThanOrEqual(2)
  })

  it('blocks style transfer on the free tier and does not edit notes', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: null }))
    act(() => result.current.applyStyleToTrack())
    expect(h.updates).toHaveLength(0)
    expect(h.notifications.some((m) => /Pro feature/.test(m))).toBe(true)
    expect(result.current.status).toMatch(/Pro feature/)
  })

  it('applies a style on the pro tier, updating every note', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: proEntitlements() }))
    act(() => result.current.setStyleId('edm'))
    act(() => result.current.applyStyleToTrack())
    expect(h.updates).toHaveLength(3)
    expect(h.updates.map((u) => u.noteId)).toEqual(['n0', 'n1', 'n2'])
    expect(result.current.status).toMatch(/Applied/)
  })

  it('applies a groove on any tier, updating note timing', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: null }))
    act(() => result.current.setFeature('groove'))
    act(() => result.current.setGroovePresetId('human'))
    act(() => result.current.applyGrooveToTrack())
    expect(h.updates).toHaveLength(3)
    for (const update of h.updates) {
      expect(update.changes.start).toBeTypeOf('number')
    }
  })

  it('produces a mastering report on the pro tier', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: proEntitlements() }))
    act(() => result.current.analyze())
    expect(result.current.report).not.toBeNull()
    expect(result.current.report?.advisories.length).toBeGreaterThan(0)
    // Emits the contract mixer-overlay directive (targets contract/mixing.ts).
    const suggestion = result.current.report?.suggestion
    expect(typeof suggestion?.masterGainDb).toBe('number')
    expect(typeof suggestion?.limiterThresholdDb).toBe('number')
    expect(suggestion?.perTrackGainDb).toBeTypeOf('object')
    expect(suggestion?.rationale).toMatch(/\S/)
  })

  it('blocks mastering on the free tier', () => {
    const h = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: null }))
    act(() => result.current.analyze())
    expect(result.current.report).toBeNull()
    expect(h.notifications.some((m) => /Pro feature/.test(m))).toBe(true)
  })

  it('reports empty-track cases for style and groove without editing notes', () => {
    const h = harness(createEmptyProject('empty'))
    const { result } = renderHook(() => useAiStudio(h.controller, { entitlements: proEntitlements() }))

    act(() => result.current.applyStyleToTrack())
    expect(result.current.status).toMatch(/Add notes to the selected track/)

    act(() => result.current.setFeature('groove'))
    act(() => result.current.applyGrooveToTrack())
    expect(result.current.status).toMatch(/Add notes to the selected track/)

    expect(h.updates).toHaveLength(0)
  })

  it('clamps the motif length and groove intensity to valid ranges', () => {
    const { controller } = harness(projectWithNotes())
    const { result } = renderHook(() => useAiStudio(controller, { entitlements: null }))

    act(() => result.current.setMotifLength(999))
    expect(result.current.motifLength).toBe(MOTIF_LENGTH_RANGE.max)
    act(() => result.current.setMotifLength(-10))
    expect(result.current.motifLength).toBe(MOTIF_LENGTH_RANGE.min)

    act(() => result.current.setGrooveIntensity(5))
    expect(result.current.grooveIntensity).toBe(1)
    act(() => result.current.setGrooveIntensity(-1))
    expect(result.current.grooveIntensity).toBe(0)
  })
})
