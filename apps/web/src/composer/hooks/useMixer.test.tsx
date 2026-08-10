import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMixer } from './useMixer'
import type { ComposerController } from './useComposer'
import { createMixerController } from '../audio/mixerController'
import { createEmptyProject, createTrack, type Project } from '../model/project'
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
  const project = makeProject()
  const base = { mixer, project, toggleMute } as unknown as ComposerController

  const make = (transportState: TransportState, positionBeats: number): ComposerController =>
    ({ ...base, transportState, positionBeats }) as ComposerController

  const view = renderHook(
    ({ controller }: { controller: ComposerController }) => useMixer(controller),
    { initialProps: { controller: make('stopped', 0) } },
  )
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
    act(() => view.result.current.clearTrackAutomation('t1'))
    expect(view.result.current.tracks[0].automated).toBe(false)

    act(() => view.result.current.writeMasterGainAutomation())
    expect(view.result.current.masterAutomated).toBe(true)
    act(() => view.result.current.clearMasterAutomation())
    expect(view.result.current.masterAutomated).toBe(false)
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
