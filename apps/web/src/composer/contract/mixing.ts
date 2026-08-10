/**
 * Mixer overlay contracts for effort #44.
 *
 * Mixer state is keyed by Track.id and intentionally does not add fields to
 * Track or Project. Insert effects come from the Plugin SDK
 * EffectContribution/EffectNode surface.
 */
import type { EffectContribution, EffectNode } from '../plugins/types'

export type { EffectContribution, EffectNode }

export interface TrackMixerState {
  trackId: string
  /** Range: -60..+6 dB. */
  gainDb: number
  /** Range: -1..+1. */
  pan: number
  solo: boolean
  /** Mirrors the existing Track.muted field, which remains the source of truth. */
  muted: boolean
}

export interface MasterBusState {
  gainDb: number
  limiterEnabled: boolean
  limiterThresholdDb: number
}

export interface MixerSnapshot {
  tracks: Readonly<Record<string, TrackMixerState>>
  master: MasterBusState
}

export interface TrackInsert {
  id: string
  effectId: EffectContribution['id']
  enabled: boolean
  params: Readonly<Record<string, number>>
}

export interface MixerController {
  getSnapshot(): MixerSnapshot
  setTrackGain(trackId: string, gainDb: number): void
  setTrackPan(trackId: string, pan: number): void
  setTrackSolo(trackId: string, solo: boolean): void
  setMaster(master: Partial<MasterBusState>): void
  listInserts(trackId: string): readonly TrackInsert[]
}

export interface AutomationPoint {
  beat: number
  value: number
}

export interface AutomationLane {
  target: 'trackGain' | 'trackPan' | 'masterGain' | string
  trackId?: string
  points: readonly AutomationPoint[]
}

export type MixerEffectNode = EffectNode
