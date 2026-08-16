import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MixerViewModel } from '../hooks/useMixer'
import { MixWorkspace } from './MixWorkspace'

const mixer: MixerViewModel = {
  tracks: [
    {
      id: 'track-1',
      name: 'Lead',
      color: '#7a2ff0',
      gainDb: -3,
      pan: 0.25,
      solo: false,
      muted: false,
      inserts: [],
      automated: false,
    },
  ],
  master: { gainDb: -1, limiterEnabled: true, limiterThresholdDb: -2 },
  masterAutomated: false,
  availableEffects: [],
  effectName: (effectId) => effectId,
  positionBeats: 0,
  lengthBeats: 16,
  snap: 0.25,
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
}

describe('<MixWorkspace />', () => {
  it('hosts mixer strips and the master bus in a dedicated workspace', () => {
    render(<MixWorkspace mixer={mixer} />)

    const workspace = screen.getByRole('region', { name: 'Mix workspace' })
    expect(within(workspace).getByRole('region', { name: 'Mixer' })).toBeVisible()
    expect(within(workspace).getByRole('group', { name: 'Lead' })).toBeVisible()
    expect(within(workspace).getByRole('group', { name: 'Master bus' })).toBeVisible()
  })
})
