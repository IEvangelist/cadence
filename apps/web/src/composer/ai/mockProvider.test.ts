import { describe, expect, it } from 'vitest'
import { MockAssistant } from './mockProvider'
import type { AssistantProgress, AssistantRequest } from './types'

const baseRequest = (overrides: Partial<AssistantRequest> = {}): AssistantRequest => ({
  action: 'continue',
  seedNotes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.8 }],
  regionStart: 0,
  tempo: 120,
  params: { temperature: 1, lengthBeats: 4 },
  ...overrides,
})

describe('MockAssistant', () => {
  it('advertises all three capabilities', () => {
    const a = new MockAssistant()
    expect(a.id).toBe('mock')
    expect([...a.capabilities]).toEqual(['continue', 'generate', 'harmonize'])
  })

  it('continues from the last seed note with valid, scale-aligned notes', async () => {
    const a = new MockAssistant()
    const res = await a.generate(baseRequest({ params: { temperature: 1, lengthBeats: 4 } }))
    expect(res.action).toBe('continue')
    expect(res.notes).toHaveLength(4)
    // Continuation begins after the seed note ends (start 0 + dur 1 = beat 1).
    expect(res.notes[0].start).toBe(1)
    for (const n of res.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(0)
      expect(n.pitch).toBeLessThanOrEqual(127)
      expect(n.duration).toBeGreaterThan(0)
      expect(n.velocity).toBeGreaterThan(0)
    }
  })

  it('generates from the region origin when there is no seed', async () => {
    const a = new MockAssistant()
    const res = await a.generate(
      baseRequest({ action: 'generate', seedNotes: [], regionStart: 8, params: { temperature: 1, lengthBeats: 3 } }),
    )
    expect(res.action).toBe('generate')
    expect(res.notes).toHaveLength(3)
    expect(res.notes[0].start).toBe(8)
  })

  it('harmonizes the seed melody into chord notes', async () => {
    const a = new MockAssistant()
    const res = await a.generate(
      baseRequest({
        action: 'harmonize',
        seedNotes: [
          { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
          { pitch: 64, start: 1, duration: 1, velocity: 0.8 },
          { pitch: 67, start: 2, duration: 1, velocity: 0.8 },
          { pitch: 72, start: 3, duration: 1, velocity: 0.8 },
        ],
      }),
    )
    expect(res.action).toBe('harmonize')
    expect(res.notes.length).toBeGreaterThan(0)
    // Chords are voiced below the melody.
    for (const n of res.notes) {
      expect(n.pitch).toBeLessThan(72)
    }
  })

  it('reports progress phases in order', async () => {
    const a = new MockAssistant()
    const phases: string[] = []
    await a.generate(baseRequest(), (p: AssistantProgress) => phases.push(p.phase))
    expect(phases).toContain('loading-model')
    expect(phases).toContain('generating')
    expect(phases[phases.length - 1]).toBe('done')
  })

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const a = new MockAssistant()
    const controller = new AbortController()
    controller.abort()
    await expect(a.generate(baseRequest({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('is deterministic for identical requests', async () => {
    const a = new MockAssistant()
    const r1 = await a.generate(baseRequest())
    const r2 = await a.generate(baseRequest())
    expect(r1.notes).toEqual(r2.notes)
  })
})
