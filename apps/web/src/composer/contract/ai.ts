/**
 * Extended AI composition contracts for effort #45.
 *
 * AI gating MUST read the existing billing Entitlements.aiGenerationsPerDay —
 * do NOT introduce a parallel entitlement model. `auto-master` targets the mixer
 * overlay in contract/mixing.ts, not raw audio.
 */
import type {
  CompositionAssistant,
  AssistantSuggestion,
  SuggestedNote,
} from '../ai/types'
import type { Entitlements } from '../../billing/entitlementsClient'

export type ExtendedAssistantAction =
  | 'continue'
  | 'generate'
  | 'harmonize'
  | 'text-to-motif'
  | 'style-transfer'
  | 'groove-humanize'
  | 'auto-master'

export interface TextPromptRequest {
  action: 'text-to-motif'
  prompt: string
  regionStart: number
  tempo: number
  params: { temperature: number; lengthBeats: number }
  signal?: AbortSignal
}

export interface StyleTransferRequest {
  action: 'style-transfer'
  seedNotes: readonly SuggestedNote[]
  styleId: string
  regionStart: number
  tempo: number
  signal?: AbortSignal
}

export interface MasteringSuggestion {
  masterGainDb: number
  limiterThresholdDb: number
  perTrackGainDb: Readonly<Record<string, number>>
  rationale: string
}

export interface AiEntitlementView {
  canUse(action: ExtendedAssistantAction, entitlements: Entitlements): boolean
  remainingGenerations(entitlements: Entitlements, usedToday: number): number
}

export type ExtendedCompositionAssistant = CompositionAssistant
export type ExtendedAssistantSuggestion = AssistantSuggestion
