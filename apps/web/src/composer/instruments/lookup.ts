/**
 * Side-effect-free instrument lookups over the Plugin SDK host.
 *
 * These helpers resolve instrument metadata/contributions from
 * {@link defaultPluginHost} but do NO work at module-load time — importing this
 * module only defines functions. That matters because low-level modules loaded
 * *during* the host's own initialization (persistence and MIDI, pulled in by the
 * core plugin's format serializers) need registry lookups without triggering the
 * eager `INSTRUMENTS` snapshot in `registry.ts`, which would run before the host
 * exists and crash. `registry.ts` composes these helpers and adds that load-time
 * snapshot for the UI, tests, and the published contract.
 */
import { defaultPluginHost } from '../plugins/defaultHost'
import type {
  InstrumentContribution,
  InstrumentDefinition,
} from '../plugins/types'

const FALLBACK_ID = 'poly-synth'

/** Project a full contribution down to its audio-free metadata. */
export function toDefinition(c: InstrumentContribution): InstrumentDefinition {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description,
    polyphonic: c.polyphonic,
    group: c.group,
  }
}

/** All currently selectable instruments (built-in + active plugins). */
export function listInstruments(): InstrumentDefinition[] {
  return defaultPluginHost.instruments().map(toDefinition)
}

/**
 * Resolve an instrument's full contribution (metadata + voice factory), falling
 * back to the poly synth when the id is unknown.
 */
export function getInstrumentContribution(id: string): InstrumentContribution {
  const all = defaultPluginHost.instruments()
  return (
    all.find((c) => c.id === id) ??
    all.find((c) => c.id === FALLBACK_ID) ??
    all[0]
  )
}

/** Look up an instrument's metadata, falling back to the poly synth. */
export function getInstrument(id: string): InstrumentDefinition {
  return toDefinition(getInstrumentContribution(id))
}
