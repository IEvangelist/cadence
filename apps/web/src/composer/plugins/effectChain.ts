/**
 * Pure master effect-chain wiring.
 *
 * Kept free of any Tone dependency (it operates on the minimal structural shape
 * of a connectable node) so the ordering/wiring logic is trivially unit-testable.
 * The engine calls {@link connectEffectChain} to route its voice bus through the
 * active effect nodes and into the master output.
 */

/** The minimal shape of a connectable audio node (Tone nodes satisfy this). */
export interface AudioConnectable {
  connect(destination: unknown): unknown
}

/** An effect's input/output pair, as produced by an {@link EffectNode}. */
export interface ChainableEffect {
  input: AudioConnectable
  output: AudioConnectable
}

/**
 * Connect `source` through `effects` (in order) into `destination`:
 * `source → effect₀ → effect₁ → … → destination`. With no effects the source
 * connects straight to the destination (so the default path is unchanged).
 */
export function connectEffectChain(
  source: AudioConnectable,
  effects: ChainableEffect[],
  destination: unknown,
): void {
  let node: AudioConnectable = source
  for (const effect of effects) {
    node.connect(effect.input)
    node = effect.output
  }
  node.connect(destination)
}
