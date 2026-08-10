/**
 * Extended instrument and preset contracts for effort #41.
 *
 * This builds on the existing Plugin SDK instrument contribution. Presets are
 * opaque, serializable parameter bags owned by the contributing instrument.
 */
import type { InstrumentId } from '../model/project'
import type {
  InstrumentContribution,
  InstrumentDefinition,
} from '../plugins/types'

export type InstrumentEngineKind = 'synth' | 'sampler' | 'soundfont'

export interface InstrumentPreset {
  id: string
  instrumentId: InstrumentId
  name: string
  category?: string
  tags?: readonly string[]
  params: Readonly<Record<string, number | string | boolean>>
}

export interface PresetBrowserEntry {
  preset: InstrumentPreset
  definition: InstrumentDefinition
}

export interface InstrumentPresetContribution {
  instrumentId: InstrumentContribution['id'] & InstrumentId
  presets: readonly InstrumentPreset[]
}

export interface SoundDesignInfo {
  engine: InstrumentEngineKind
  sampleUrl?: string
  polyphonyLimit?: number
}
