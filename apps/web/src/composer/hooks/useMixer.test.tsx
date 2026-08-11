import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMixer } from './useMixer'
import type { ComposerController } from './useComposer'
import { createMixerController } from '../audio/mixerController'
import { createEmptyProject, createTrack, type Project } from '../model/project'
import { clearLane, removeLanePoint, writeLanePoint } from '../model/automation'
import type { TransportState } from '../audio/engine'

function makeProject(): Project {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack({ name: 'Lead', color: '#f0f', notes: [] }, 't1'),
    createTrack({ name: 'Bass', color: '#0ff', notes: [], muted: true }, 't2'),
  ]
  return project
}

function setup() {
  const mixer = createMixerController()
  const toggleMute = vi.fn()
  let project = makeProject()
  let transportState: TransportState = 'stopped'
  let positionBeats = 0
  let rerender: (props: { controller: ComposerController }) => void = () => {}

  // A stateful stand-in for the composer controller: automation authoring routes
  // through the real model helpers (as the reducer does) and re-renders the hook
  // with the updated project, mirroring the production persist-then-hydrate flow.
  const build = (): ComposerController =>
    ({
      mixer,
      project,
      transportState,
      positionBeats,
      snap: 1,
      toggleMute,
      writeAutomationPoint: (
        target: Parameters<ComposerController['writeAutomationPoint']>[0],
        trackId: string | undefined,
        point: { beat: number; value: number },
      ) => {
        project = {
          ...project,
          automation: writeLanePoint(project.automation ?? [], target, trackId, point),
        }
        rerender({ controller: build() })
      },
      removeAutomationPoint: (
        target: Parameters<ComposerController['removeAutomationPoint']>[0],
        trackId: string | undefined,
        beat: number,
      ) => {
        project = {
          ...project,
          automation: removeLanePoint(project.automation ?? [], target, trackId, beat),
        }
        rerender({ controller: build() })
      },
      clearAutomationLane: (
        target: Parameters<ComposerController['clearAutomationLane']>[0],
        trackId?: string,
      ) => {
        project = {
          ...project,
          automation: clearLane(project.automation ?? [], target, trackId),
        }
        rerender({ controller: build() })
      },
    }) as unknown as ComposerController

  const view = renderHook(
    ({ controller }: { controller: ComposerController }) => useMixer(controller),
    { initialProps: { controller: build() } },
  )
  rerender = view.rerender
  const make = (ts: TransportState, pos: number): ComposerController => {
    transportState = ts
    positionBeats = pos
    return build()
  }
  return { mixer, toggleMute, view, make }
}

describe('useMixer', () => {
  it('merges project tracks with mixer state', () => {
    const { view } = setup()
    const { tracks } = view.result.current
    expect(tracks.map((t) => t.name)).toEqual(['Lead', 'Bass'])
    expect(tracks[0]).toMatchObject({ id: 't1', color: '#f0f', gainDb: 0, pan: 0, solo: false })
    expect(tracks[1].muted).toBe(true)
  })

  it('exposes the host insert palette including the mixer effects', () => {
    const { view } = setup()
    const ids = view.result.current.availableEffects.map((e) => e.id)
    expect(ids).toContain('reverb')
    expect(ids).toContain('eq3')
  })

  it('sets gain/pan and toggles solo through the controller', () => {
    const { view } = setup()
    act(() => view.result.current.setTrackGain('t1', -6))
    act(() => view.result.current.setTrackPan('t1', 0.5))
    act(() => view.result.current.toggleSolo('t1'))
    const lead = view.result.current.tracks[0]
    expect(lead.gainDb).toBe(-6)
    expect(lead.pan).toBe(0.5)
    expect(lead.solo).toBe(true)
  })

  it('delegates mute to the composer controller (project owns muted)', () => {
    const { view, toggleMute } = setup()
    act(() => view.result.current.toggleMute('t1'))
    expect(toggleMute).toHaveBeenCalledWith('t1')
  })

  it('adds, toggles, and removes inserts', () => {
    const { view } = setup()
    act(() => view.result.current.addInsert('t1', 'reverb'))
    expect(view.result.current.tracks[0].inserts).toHaveLength(1)

    const insertId = view.result.current.tracks[0].inserts[0].id
    act(() => view.result.current.toggleInsert('t1', insertId))
    expect(view.result.current.tracks[0].inserts[0].enabled).toBe(false)

    act(() => view.result.current.removeInsert('t1', insertId))
    expect(view.result.current.tracks[0].inserts).toHaveLength(0)
  })

  it('resolves effect labels with a fallback to the id', () => {
    const { view } = setup()
    expect(view.result.current.effectName('reverb')).toBe('Studio Reverb')
    expect(view.result.current.effectName('mystery')).toBe('mystery')
  })

  it('updates the master bus', () => {
    const { view } = setup()
    act(() => view.result.current.setMasterGain(-3))
    act(() => view.result.current.setLimiterEnabled(true))
    act(() => view.result.current.setLimiterThreshold(-2))
    expect(view.result.current.master).toEqual({
      gainDb: -3,
      limiterEnabled: true,
      limiterThresholdDb: -2,
    })
  })

  it('flags automation on tracks and master, and clears it', () => {
    const { view } = setup()
    act(() => view.result.current.writeTrackGainAutomation('t1'))
    expect(view.result.current.tracks[0].automated).toBe(true)
    act(() => view.result.current.writeTrackPanAutomation('t1'))
    act(() => view.result.current.clearAutomationLane('trackGain', 't1'))
    act(() => view.result.current.clearAutomationLane('trackPan', 't1'))
    expect(view.result.current.tracks[0].automated).toBe(false)

    act(() => view.result.current.writeMasterGainAutomation())
    expect(view.result.current.masterAutomated).toBe(true)
    act(() => view.result.current.clearAutomationLane('masterGain'))
    expect(view.result.current.masterAutomated).toBe(false)
  })

  it('draws and removes explicit lane points and exposes them to the UI', () => {
    const { view } = setup()
    act(() => view.result.current.writeAutomationPoint('trackGain', 't1', 0, -6))
    act(() => view.result.current.writeAutomationPoint('trackGain', 't1', 4, 0))
    const lane = view.result.current.automation.find(
      (l) => l.target === 'trackGain' && l.trackId === 't1',
    )
    expect(lane?.points).toEqual([{ beat: 0, value: -6 }, { beat: 4, value: 0 }])

    act(() => view.result.current.removeAutomationPoint('trackGain', 't1', 0))
    const after = view.result.current.automation.find(
      (l) => l.target === 'trackGain' && l.trackId === 't1',
    )
    expect(after?.points).toEqual([{ beat: 4, value: 0 }])
  })

  it('mirrors project automation into the controller for playback (hydration)', () => {
    const { view, mixer } = setup()
    const spy = vi.spyOn(mixer, 'setAutomation')
    act(() => view.result.current.writeAutomationPoint('masterGain', undefined, 4, -6))
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls.at(-1)?.[0]).toEqual([
      { target: 'masterGain', points: [{ beat: 4, value: -6 }] },
    ])
  })

  it('applies automation while playing and releases when stopped', () => {
    const { view, mixer, make } = setup()
    const applySpy = vi.spyOn(mixer, 'applyAutomationAt')
    const releaseSpy = vi.spyOn(mixer, 'releaseAutomation')

    view.rerender({ controller: make('playing', 2) })
    expect(applySpy).toHaveBeenCalledWith(2)

    releaseSpy.mockClear()
    view.rerender({ controller: make('stopped', 0) })
    expect(releaseSpy).toHaveBeenCalled()
  })
})
