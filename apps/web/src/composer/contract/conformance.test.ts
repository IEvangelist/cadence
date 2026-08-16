import { describe, expect, it } from 'vitest'
import {
  controllerImplementsContract,
  publicApiExcludesCollabInternals,
  createEmptyProject,
  LocalStorageProjectStore,
  MemoryStorage,
  type AudioEngine,
  type CollaborationStatus,
  type ComposerViewport,
  type CompositionAssistant,
  type InstrumentPreset,
  type OfflineCacheState,
  type Participant,
  type ProjectStore,
  type ProjectTemplate,
  type PwaController,
  type SoundDesignInfo,
  type TrackMixerState,
  type AiEntitlementView,
  type ExportAction,
  type ExportEntitlementView,
  COMPOSER_CONTRACT_VERSION,
  type ProjectMix,
} from '.'
import { SilentAudioEngine } from '../audio/engine'
import { MockAssistant } from '../ai/mockProvider'
import type { Entitlements } from '../../billing/entitlementsClient'

describe('composer contract conformance', () => {
  it('keeps the controller aligned with the frozen public surface (forward conformance)', () => {
    expect(controllerImplementsContract).toBe(true)
    expect(COMPOSER_CONTRACT_VERSION).toBe('1.2.0')
  })

  it('excludes #9 collaboration sync internals from the public contract', () => {
    expect(publicApiExcludesCollabInternals).toBe(true)
  })

  it('proves the real implementations satisfy the published contracts', () => {
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const projectStore: ProjectStore = store
    const audioEngine: AudioEngine = new SilentAudioEngine()
    const assistant: CompositionAssistant = new MockAssistant()

    expect(projectStore).toBe(store)
    expect(audioEngine.state).toBe('stopped')
    expect(assistant.capabilities).toContain('generate')
  })

  it('keeps additive extension seams implementable by plain objects', async () => {
    const mixerTrack: TrackMixerState = {
      trackId: 'track_1',
      gainDb: -3,
      pan: 0.25,
      solo: false,
      muted: false,
    }
    const mixerOverlay = { [mixerTrack.trackId]: mixerTrack }
    const persistedMix: ProjectMix = {
      tracks: {
        track_1: { gainDb: -3, pan: 0.25, solo: false, inserts: [] },
      },
      master: { gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 },
    }

    const template: ProjectTemplate = {
      id: 'empty-template',
      name: 'Empty',
      description: 'A test template',
      category: 'empty',
      create: () => createEmptyProject('project_from_template'),
    }

    const entitlementView: AiEntitlementView = {
      canUse: (_action, entitlements) => entitlements.aiGenerationsPerDay > 0,
      remainingGenerations: (entitlements, usedToday) =>
        Math.max(0, entitlements.aiGenerationsPerDay - usedToday),
    }

    const exportView: ExportEntitlementView = {
      appliesWatermark: (_action: ExportAction, entitlements) =>
        entitlements.watermarkExports !== false,
    }

    const freeEntitlements: Entitlements = {
      tier: 'free',
      watermarkExports: true,
      maxProjects: 3,
      aiGenerationsPerDay: 0,
      advancedFormats: false,
      stemSeparation: false,
      collaborationSeats: 1,
    }

    const self: Participant = {
      id: '42',
      userId: 'user_vasquez',
      displayName: 'Vasquez',
      color: '#ff00aa',
      isSelf: true,
    }
    const collabStatus: CollaborationStatus = {
      canShare: true,
      isActive: true,
      role: 'owner',
      participants: [self] as readonly Participant[],
    }

    const preset: InstrumentPreset = {
      id: 'preset_bright',
      instrumentId: 'poly-synth',
      name: 'Bright Keys',
      tags: ['keys'],
      params: { cutoff: 0.8, enabled: true },
    }
    const soundDesign: SoundDesignInfo = { engine: 'synth', polyphonyLimit: 8 }
    const viewport: ComposerViewport = {
      kind: 'desktop',
      width: 1280,
      height: 720,
      coarsePointer: false,
    }
    const offline: OfflineCacheState = { status: 'offline', pendingSync: 2 }
    const pwa: PwaController = {
      installState: 'available',
      promptInstall: async () => true,
    }

    expect(template.create().tracks.length).toBeGreaterThanOrEqual(1)
    expect(mixerOverlay.track_1.trackId).toBe('track_1')
    expect(persistedMix.tracks.track_1.gainDb).toBe(-3)
    expect(entitlementView.canUse('generate', freeEntitlements)).toBe(false)
    expect(exportView.appliesWatermark('wav', freeEntitlements)).toBe(true)
    expect(collabStatus.participants[0].displayName).toBe('Vasquez')
    expect(collabStatus.participants[0].isSelf).toBe(true)
    expect(collabStatus.participants[0].role).toBeUndefined()
    expect(collabStatus.isActive).toBe(true)
    expect(collabStatus.participants).toHaveLength(1)
    expect(preset.instrumentId).toBe('poly-synth')
    expect(soundDesign.engine).toBe('synth')
    expect(viewport.kind).toBe('desktop')
    expect(offline.pendingSync).toBe(2)
    await expect(pwa.promptInstall()).resolves.toBe(true)
  })
})
