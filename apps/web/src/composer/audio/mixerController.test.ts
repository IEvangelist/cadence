import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMixerController } from './mixerController'
import type { MixerGraph } from './mixerGraph'
import type { EffectNode } from '../plugins/types'
import type { ProjectMix } from '../model/mix'

function fakeGraph() {
  return {
    channelInput: vi.fn(() => ({}) as MixerGraph['output']),
    ensureChannel: vi.fn(),
    disposeChannel: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    setChannelAudible: vi.fn(),
    setTrackInserts: vi.fn(),
    setMasterGain: vi.fn(),
    setLimiter: vi.fn(),
    output: {} as MixerGraph['output'],
    dispose: vi.fn(),
  }
}

const fakeEffect = (): EffectNode => ({ input: {}, output: {}, dispose: vi.fn() }) as unknown as EffectNode

describe('mixerController (state-only)', () => {
  it('starts empty with a default master bus', () => {
    const mixer = createMixerController()
    const snapshot = mixer.getSnapshot()
    expect(snapshot.tracks).toEqual({})
    expect(snapshot.master).toEqual({ gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 })
  })

  it('syncs tracks and mirrors Track.muted', () => {
    const mixer = createMixerController()
    mixer.syncTracks([
      { id: 't1', muted: false },
      { id: 't2', muted: true },
    ])
    const snapshot = mixer.getSnapshot()
    expect(Object.keys(snapshot.tracks)).toEqual(['t1', 't2'])
    expect(snapshot.tracks.t2.muted).toBe(true)
  })

  it('drops state for tracks that disappear', () => {
    const mixer = createMixerController()
    mixer.syncTracks([{ id: 't1', muted: false }, { id: 't2', muted: false }])
    mixer.syncTracks([{ id: 't1', muted: false }])
    expect(Object.keys(mixer.getSnapshot().tracks)).toEqual(['t1'])
  })

  it('clamps gain, pan, and limiter threshold to their ranges', () => {
    const mixer = createMixerController()
    mixer.setTrackGain('t1', 99)
    mixer.setTrackGain('t2', -999)
    mixer.setTrackPan('t1', 5)
    mixer.setMaster({ limiterThresholdDb: 20 })
    const snapshot = mixer.getSnapshot()
    expect(snapshot.tracks.t1.gainDb).toBe(6)
    expect(snapshot.tracks.t2.gainDb).toBe(-60)
    expect(snapshot.tracks.t1.pan).toBe(1)
    expect(snapshot.master.limiterThresholdDb).toBe(0)
  })

  it('merges partial master updates', () => {
    const mixer = createMixerController()
    mixer.setMaster({ gainDb: -3 })
    mixer.setMaster({ limiterEnabled: true })
    expect(mixer.getSnapshot().master).toEqual({
      gainDb: -3,
      limiterEnabled: true,
      limiterThresholdDb: -1,
    })
  })

  it('adds, toggles, and removes inserts', () => {
    const mixer = createMixerController()
    mixer.addInsert('t1', 'reverb')
    const inserts = mixer.listInserts('t1')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ effectId: 'reverb', enabled: true })

    const insertId = inserts[0].id
    mixer.setInsertEnabled('t1', insertId, false)
    expect(mixer.listInserts('t1')[0].enabled).toBe(false)

    mixer.removeInsert('t1', insertId)
    expect(mixer.listInserts('t1')).toHaveLength(0)
  })

  it('hydrates and replaces persisted track, insert, and master state', () => {
    const mixer = createMixerController()
    mixer.syncTracks([{ id: 't1', muted: true }, { id: 'old', muted: false }])
    const mix: ProjectMix = {
      tracks: {
        t1: {
          gainDb: -9,
          pan: 0.35,
          solo: true,
          inserts: [
            { id: 'missing', effectId: 'plugin.missing', enabled: true, params: { mix: 0.5 } },
          ],
        },
      },
      master: { gainDb: -2, limiterEnabled: true, limiterThresholdDb: -4 },
    }

    mixer.hydrate(mix)

    expect(mixer.getSnapshot()).toEqual({
      tracks: {
        t1: { trackId: 't1', gainDb: -9, pan: 0.35, solo: true, muted: true },
      },
      master: { gainDb: -2, limiterEnabled: true, limiterThresholdDb: -4 },
    })
    expect(mixer.listInserts('t1')).toEqual([
      { id: 'missing', effectId: 'plugin.missing', enabled: true, params: { mix: 0.5 } },
    ])
  })

  it('ignores insert ops on unknown tracks/inserts', () => {
    const mixer = createMixerController()
    mixer.removeInsert('nope', 'x')
    mixer.setInsertEnabled('nope', 'x', true)
    expect(mixer.listInserts('nope')).toEqual([])
  })

  it('writes, replaces, and clears automation lanes', () => {
    const mixer = createMixerController()
    mixer.writeAutomationPoint('trackGain', 't1', { beat: 0, value: -6 })
    mixer.writeAutomationPoint('trackGain', 't1', { beat: 0, value: -3 }) // replace at beat 0
    mixer.writeAutomationPoint('trackGain', 't1', { beat: 4, value: 0 })
    const lane = mixer.getView().automation.find((l) => l.trackId === 't1')
    expect(lane?.points).toEqual([{ beat: 0, value: -3 }, { beat: 4, value: 0 }])

    mixer.clearAutomationLane('trackGain', 't1')
    expect(mixer.getView().automation).toHaveLength(0)
  })

  it('replaces the whole lane set via setAutomation (playback mirror)', () => {
    const mixer = createMixerController()
    mixer.writeAutomationPoint('trackGain', 't1', { beat: 0, value: -6 })
    mixer.setAutomation([
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
      { target: 'trackPan', trackId: 't2', points: [{ beat: 1, value: 0.5 }] },
    ])
    const view = mixer.getView().automation
    expect(view).toEqual([
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
      { target: 'trackPan', trackId: 't2', points: [{ beat: 1, value: 0.5 }] },
    ])
  })

  it('clones lanes passed to setAutomation so later external edits do not leak in', () => {
    const mixer = createMixerController()
    const points = [{ beat: 0, value: -2 }]
    const lanes = [{ target: 'masterGain' as const, points }]
    mixer.setAutomation(lanes)
    points.push({ beat: 4, value: 0 })
    expect(mixer.getView().automation[0].points).toHaveLength(1)
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const mixer = createMixerController()
    const listener = vi.fn()
    const unsubscribe = mixer.subscribe(listener)
    mixer.setTrackGain('t1', -2)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    mixer.setTrackGain('t1', -4)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('returns a new view object only when state changes', () => {
    const mixer = createMixerController()
    const before = mixer.getView()
    expect(mixer.getView()).toBe(before)
    mixer.setTrackPan('t1', 0.2)
    expect(mixer.getView()).not.toBe(before)
  })

  it('no-ops automation application without a graph', () => {
    const mixer = createMixerController()
    expect(() => {
      mixer.applyAutomationAt(2)
      mixer.releaseAutomation()
    }).not.toThrow()
  })
})

describe('mixerController (with graph)', () => {
  let graph: ReturnType<typeof fakeGraph>

  beforeEach(() => {
    graph = fakeGraph()
  })

  it('ensures + disposes channels through the graph on sync', () => {
    const mixer = createMixerController({ graph })
    mixer.syncTracks([{ id: 't1', muted: false }])
    expect(graph.ensureChannel).toHaveBeenCalledWith('t1')
    mixer.syncTracks([])
    expect(graph.disposeChannel).toHaveBeenCalledWith('t1')
  })

  it('folds mute + solo into per-channel audibility', () => {
    const mixer = createMixerController({ graph })
    mixer.syncTracks([{ id: 't1', muted: false }, { id: 't2', muted: false }])
    graph.setChannelAudible.mockClear()
    // Soloing t1 should silence t2.
    mixer.setTrackSolo('t1', true)
    expect(graph.setChannelAudible).toHaveBeenCalledWith('t1', true)
    expect(graph.setChannelAudible).toHaveBeenCalledWith('t2', false)
  })

  it('mutes a channel regardless of solo', () => {
    const mixer = createMixerController({ graph })
    mixer.syncTracks([{ id: 't1', muted: true }])
    expect(graph.setChannelAudible).toHaveBeenLastCalledWith('t1', false)
  })

  it('pushes gain/pan and master changes to the graph', () => {
    const mixer = createMixerController({ graph })
    mixer.setTrackGain('t1', -6)
    mixer.setTrackPan('t1', -0.5)
    mixer.setMaster({ gainDb: -3, limiterEnabled: true, limiterThresholdDb: -2 })
    expect(graph.setTrackGain).toHaveBeenCalledWith('t1', -6)
    expect(graph.setTrackPan).toHaveBeenCalledWith('t1', -0.5)
    expect(graph.setMasterGain).toHaveBeenCalledWith(-3)
    expect(graph.setLimiter).toHaveBeenCalledWith(true, -2)
  })

  it('applies hydrated state to the graph and bypasses unavailable effects', () => {
    const mixer = createMixerController({ graph, createEffect: () => null })
    mixer.syncTracks([{ id: 't1', muted: false }])
    mixer.hydrate({
      tracks: {
        t1: {
          gainDb: -12,
          pan: -0.4,
          solo: false,
          inserts: [
            { id: 'ghost', effectId: 'plugin.missing', enabled: true, params: {} },
          ],
        },
      },
      master: { gainDb: -3, limiterEnabled: true, limiterThresholdDb: -2 },
    })

    expect(graph.setTrackGain).toHaveBeenLastCalledWith('t1', -12)
    expect(graph.setTrackPan).toHaveBeenLastCalledWith('t1', -0.4)
    expect(graph.setTrackInserts).toHaveBeenLastCalledWith('t1', [])
    expect(graph.setMasterGain).toHaveBeenLastCalledWith(-3)
    expect(graph.setLimiter).toHaveBeenLastCalledWith(true, -2)
  })

  it('does not rebuild unchanged insert chains during gain hydration', () => {
    const mixer = createMixerController({ graph, createEffect: () => fakeEffect() })
    const initial: ProjectMix = {
      tracks: {
        t1: {
          gainDb: -6,
          pan: 0,
          solo: false,
          inserts: [{ id: 'verb', effectId: 'reverb', enabled: true, params: {} }],
        },
      },
      master: { gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 },
    }
    mixer.hydrate(initial)
    graph.setTrackInserts.mockClear()

    mixer.hydrate({
      ...initial,
      tracks: {
        t1: { ...initial.tracks.t1, gainDb: -12 },
      },
    })

    expect(graph.setTrackGain).toHaveBeenLastCalledWith('t1', -12)
    expect(graph.setTrackInserts).not.toHaveBeenCalled()
  })

  it('re-resolves insert chains when plugin availability changes', () => {
    const createEffect = vi.fn(() => fakeEffect())
    const mixer = createMixerController({ graph, createEffect })
    mixer.hydrate({
      tracks: {
        t1: {
          gainDb: 0,
          pan: 0,
          solo: false,
          inserts: [{ id: 'verb', effectId: 'reverb', enabled: true, params: {} }],
        },
      },
      master: { gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 },
    })
    createEffect.mockClear()
    graph.setTrackInserts.mockClear()

    mixer.refreshInserts()

    expect(createEffect).toHaveBeenCalledWith('reverb')
    expect(graph.setTrackInserts).toHaveBeenCalledWith('t1', [expect.anything()])
  })

  it('builds insert nodes from enabled inserts via createEffect', () => {
    const createEffect = vi.fn(() => fakeEffect())
    const mixer = createMixerController({ graph, createEffect })
    mixer.addInsert('t1', 'reverb')
    expect(createEffect).toHaveBeenCalledWith('reverb')
    expect(graph.setTrackInserts).toHaveBeenLastCalledWith('t1', [expect.anything()])

    // Disabling the insert rebuilds the chain with no nodes.
    const insertId = mixer.listInserts('t1')[0].id
    mixer.setInsertEnabled('t1', insertId, false)
    expect(graph.setTrackInserts).toHaveBeenLastCalledWith('t1', [])
  })

  it('skips insert nodes when the effect cannot be built', () => {
    const mixer = createMixerController({ graph, createEffect: () => null })
    mixer.addInsert('t1', 'ghost')
    expect(graph.setTrackInserts).toHaveBeenLastCalledWith('t1', [])
  })

  it('applies interpolated automation to the graph', () => {
    const mixer = createMixerController({ graph })
    mixer.writeAutomationPoint('trackGain', 't1', { beat: 0, value: -6 })
    mixer.writeAutomationPoint('trackPan', 't1', { beat: 0, value: 0.5 })
    mixer.writeAutomationPoint('masterGain', undefined, { beat: 0, value: -2 })
    graph.setTrackGain.mockClear()
    graph.setTrackPan.mockClear()
    graph.setMasterGain.mockClear()

    mixer.applyAutomationAt(0)
    expect(graph.setTrackGain).toHaveBeenCalledWith('t1', -6)
    expect(graph.setTrackPan).toHaveBeenCalledWith('t1', 0.5)
    expect(graph.setMasterGain).toHaveBeenCalledWith(-2)
  })

  it('restores manual values on release', () => {
    const mixer = createMixerController({ graph })
    mixer.syncTracks([{ id: 't1', muted: false }])
    mixer.setTrackGain('t1', -4)
    graph.setTrackGain.mockClear()
    graph.setMasterGain.mockClear()

    mixer.releaseAutomation()
    expect(graph.setTrackGain).toHaveBeenCalledWith('t1', -4)
    expect(graph.setMasterGain).toHaveBeenCalledWith(0)
  })

  it('disposes the graph when disposed', () => {
    const mixer = createMixerController({ graph })
    mixer.dispose()
    expect(graph.dispose).toHaveBeenCalledTimes(1)
  })
})
