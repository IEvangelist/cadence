import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { MixerPanel } from './MixerPanel'
import type { MixerViewModel, MixerTrackView } from '../hooks/useMixer'

function makeViewModel(overrides: Partial<MixerViewModel> = {}): MixerViewModel {
  const tracks: MixerTrackView[] = [
    {
      id: 't1',
      name: 'Lead',
      color: '#f0f',
      gainDb: 0,
      pan: 0,
      solo: false,
      muted: false,
      inserts: [{ id: 'i1', effectId: 'reverb', enabled: true, params: {} }],
      automated: true,
    },
    {
      id: 't2',
      name: 'Bass',
      color: '#0ff',
      gainDb: -6,
      pan: -0.5,
      solo: true,
      muted: true,
      inserts: [],
      automated: false,
    },
  ]
  return {
    tracks,
    master: { gainDb: 0, limiterEnabled: true, limiterThresholdDb: -1 },
    masterAutomated: false,
    availableEffects: [
      { id: 'reverb', name: 'Studio Reverb' },
      { id: 'eq3', name: 'Parametric EQ' },
    ],
    effectName: (id) => (id === 'reverb' ? 'Studio Reverb' : id),
    positionBeats: 0,
    lengthBeats: 8,
    snap: 1,
    automation: [],
    setTrackGain: vi.fn(),
    setTrackPan: vi.fn(),
    toggleSolo: vi.fn(),
    toggleMute: vi.fn(),
    addInsert: vi.fn(),
    removeInsert: vi.fn(),
    toggleInsert: vi.fn(),
    setMasterGain: vi.fn(),
    setLimiterEnabled: vi.fn(),
    setLimiterThreshold: vi.fn(),
    writeTrackGainAutomation: vi.fn(),
    writeTrackPanAutomation: vi.fn(),
    writeMasterGainAutomation: vi.fn(),
    writeAutomationPoint: vi.fn(),
    removeAutomationPoint: vi.fn(),
    clearAutomationLane: vi.fn(),
    ...overrides,
  }
}

const leadStrip = () => within(screen.getByRole('group', { name: /Lead/ }))
const masterStrip = () => within(screen.getByRole('group', { name: 'Master bus' }))

describe('MixerPanel', () => {
  it('renders a strip per track with pressed mute/solo state', () => {
    render(<MixerPanel mixer={makeViewModel()} />)
    expect(screen.getByRole('group', { name: /Lead/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Bass/ })).toBeInTheDocument()
    // Bass is muted + soloed.
    const bass = within(screen.getByRole('group', { name: /Bass/ }))
    expect(bass.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true')
    expect(bass.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('wires gain, pan, mute, and solo controls', () => {
    coversInteractions(
      'studio.mixer.track.gain',
      'studio.mixer.track.pan',
      'studio.mixer.track.mute',
      'studio.mixer.track.solo',
    )
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    fireEvent.change(leadStrip().getByRole('slider', { name: /Gain/ }), { target: { value: '3' } })
    fireEvent.change(leadStrip().getByRole('slider', { name: /Pan/ }), { target: { value: '0.5' } })
    fireEvent.click(leadStrip().getByRole('button', { name: 'Mute' }))
    fireEvent.click(leadStrip().getByRole('button', { name: 'Solo' }))
    expect(mixer.setTrackGain).toHaveBeenCalledWith('t1', 3)
    expect(mixer.setTrackPan).toHaveBeenCalledWith('t1', 0.5)
    expect(mixer.toggleMute).toHaveBeenCalledWith('t1')
    expect(mixer.toggleSolo).toHaveBeenCalledWith('t1')
  })

  it('adds the selected insert and manages existing inserts', () => {
    coversInteractions(
      'studio.mixer.insert.select',
      'studio.mixer.insert.add',
      'studio.mixer.insert.toggle',
      'studio.mixer.insert.remove',
    )
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    const strip = leadStrip()

    fireEvent.change(strip.getByRole('combobox', { name: /Add insert to Lead/ }), {
      target: { value: 'eq3' },
    })
    fireEvent.click(strip.getByRole('button', { name: 'Add' }))
    expect(mixer.addInsert).toHaveBeenCalledWith('t1', 'eq3')

    fireEvent.click(strip.getByRole('checkbox', { name: 'Studio Reverb' }))
    expect(mixer.toggleInsert).toHaveBeenCalledWith('t1', 'i1')

    fireEvent.click(strip.getByRole('button', { name: /Remove Studio Reverb/ }))
    expect(mixer.removeInsert).toHaveBeenCalledWith('t1', 'i1')
  })

  it('defaults the add-insert selection to the first effect', () => {
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    // No explicit selection change → adds the first available effect.
    fireEvent.click(leadStrip().getByRole('button', { name: 'Add' }))
    expect(mixer.addInsert).toHaveBeenCalledWith('t1', 'reverb')
  })

  it('wires the master bus controls', () => {
    coversInteractions(
      'studio.mixer.master.gain',
      'studio.mixer.master.limiter',
      'studio.mixer.master.ceiling',
    )
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    const master = masterStrip()
    fireEvent.change(master.getByRole('slider', { name: /Gain/ }), { target: { value: '-2' } })
    fireEvent.click(master.getByRole('checkbox', { name: 'Limiter' }))
    fireEvent.change(master.getByRole('slider', { name: /Ceiling/ }), { target: { value: '-3' } })
    expect(mixer.setMasterGain).toHaveBeenCalledWith(-2)
    expect(mixer.setLimiterEnabled).toHaveBeenCalledWith(false)
    expect(mixer.setLimiterThreshold).toHaveBeenCalledWith(-3)
  })

  it('disables the ceiling slider when the limiter is off', () => {
    const mixer = makeViewModel({ master: { gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 } })
    render(<MixerPanel mixer={mixer} />)
    expect(masterStrip().getByRole('slider', { name: /Ceiling/ })).toBeDisabled()
  })

  it('adds automation points at the playhead for each lane', () => {
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    const lead = leadStrip()
    fireEvent.click(
      within(lead.getByRole('group', { name: 'Volume automation' })).getByRole('button', {
        name: 'Add point',
      }),
    )
    fireEvent.click(
      within(lead.getByRole('group', { name: 'Pan automation' })).getByRole('button', {
        name: 'Add point',
      }),
    )
    expect(mixer.writeTrackGainAutomation).toHaveBeenCalledWith('t1')
    expect(mixer.writeTrackPanAutomation).toHaveBeenCalledWith('t1')

    fireEvent.click(
      within(masterStrip().getByRole('group', { name: 'Master gain automation' })).getByRole(
        'button',
        { name: 'Add point' },
      ),
    )
    expect(mixer.writeMasterGainAutomation).toHaveBeenCalled()
  })

  it('removes and clears points through the lane callbacks', () => {
    const mixer = makeViewModel({
      automation: [{ target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] }],
    })
    render(<MixerPanel mixer={mixer} />)
    const volume = within(leadStrip().getByRole('group', { name: 'Volume automation' }))
    fireEvent.click(volume.getByRole('button', { name: /Remove Volume point at beat 0/ }))
    expect(mixer.removeAutomationPoint).toHaveBeenCalledWith('trackGain', 't1', 0)
    fireEvent.click(volume.getByRole('button', { name: 'Clear Volume automation' }))
    expect(mixer.clearAutomationLane).toHaveBeenCalledWith('trackGain', 't1')
  })

  it('hides a lane clear button when the lane has no points', () => {
    const mixer = makeViewModel()
    render(<MixerPanel mixer={mixer} />)
    const volume = within(leadStrip().getByRole('group', { name: 'Volume automation' }))
    expect(volume.queryByRole('button', { name: /Clear/ })).toBeNull()
  })
})
