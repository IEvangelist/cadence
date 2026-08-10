/**
 * The Tone.js audio graph behind the #44 mixer.
 *
 * Sits between the instrument voices and the engine's existing master path. Each
 * track gets a channel strip — `input → gain(dB) → panner → [inserts] → gate` —
 * and every strip sums into a master bus — `masterGain(dB) → [limiter] → output`.
 * With default settings (0 dB, centre pan, open gate, limiter off) every stage is
 * unity/transparent, so wiring the mixer in does not change the default sound.
 *
 * The graph is pure audio plumbing: it holds no UI/snapshot state (that lives in
 * {@link MixerController}). It is imperative and mockable, mirroring the engine's
 * own Tone usage so it unit-tests without Web Audio.
 */
import * as Tone from 'tone'
import type { EffectNode } from '../plugins/types'
import { connectEffectChain } from '../plugins/effectChain'

/** Convert a decibel value to a linear gain multiplier (0 dB → 1). */
export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

interface Channel {
  /** Voices connect here. */
  input: Tone.Gain
  gain: Tone.Gain
  panner: Tone.Panner
  /** Mute/solo gate: 1 = audible, 0 = silenced. */
  gate: Tone.Gain
  inserts: EffectNode[]
}

/** The imperative surface the engine + controller drive. */
export interface MixerGraph {
  /** Ensure a channel for `trackId` exists and return its input (a voice target). */
  channelInput(trackId: string): Tone.Gain
  ensureChannel(trackId: string): void
  disposeChannel(trackId: string): void
  setTrackGain(trackId: string, gainDb: number): void
  setTrackPan(trackId: string, pan: number): void
  setChannelAudible(trackId: string, audible: boolean): void
  /** Replace a channel's insert chain, disposing the previous insert nodes. */
  setTrackInserts(trackId: string, nodes: EffectNode[]): void
  setMasterGain(gainDb: number): void
  setLimiter(enabled: boolean, thresholdDb: number): void
  /** The master-bus output; the engine connects this into its own master path. */
  readonly output: Tone.Gain
  dispose(): void
}

/** Build the mixer's Tone audio graph. */
export function createMixerGraph(): MixerGraph {
  const output = new Tone.Gain(1)
  const masterGain = new Tone.Gain(1)
  const limiter = new Tone.Limiter(-1)
  let limiterEnabled = false
  const channels = new Map<string, Channel>()

  const wireMaster = (): void => {
    masterGain.disconnect()
    limiter.disconnect()
    if (limiterEnabled) {
      masterGain.connect(limiter)
      limiter.connect(output)
    } else {
      masterGain.connect(output)
    }
  }
  wireMaster()

  const ensure = (trackId: string): Channel => {
    const existing = channels.get(trackId)
    if (existing) return existing
    const channel: Channel = {
      input: new Tone.Gain(1),
      gain: new Tone.Gain(1),
      panner: new Tone.Panner(0),
      gate: new Tone.Gain(1),
      inserts: [],
    }
    channel.input.connect(channel.gain)
    channel.gain.connect(channel.panner)
    channel.panner.connect(channel.gate)
    channel.gate.connect(masterGain)
    channels.set(trackId, channel)
    return channel
  }

  const disposeInserts = (channel: Channel): void => {
    for (const insert of channel.inserts) insert.dispose()
    channel.inserts = []
  }

  const disposeChannelNodes = (channel: Channel): void => {
    disposeInserts(channel)
    channel.input.dispose()
    channel.gain.dispose()
    channel.panner.dispose()
    channel.gate.dispose()
  }

  return {
    channelInput(trackId) {
      return ensure(trackId).input
    },
    ensureChannel(trackId) {
      ensure(trackId)
    },
    disposeChannel(trackId) {
      const channel = channels.get(trackId)
      if (!channel) return
      disposeChannelNodes(channel)
      channels.delete(trackId)
    },
    setTrackGain(trackId, gainDb) {
      ensure(trackId).gain.gain.value = dbToGain(gainDb)
    },
    setTrackPan(trackId, pan) {
      ensure(trackId).panner.pan.value = pan
    },
    setChannelAudible(trackId, audible) {
      ensure(trackId).gate.gain.value = audible ? 1 : 0
    },
    setTrackInserts(trackId, nodes) {
      const channel = ensure(trackId)
      // Re-route panner → [new inserts] → gate, disposing the previous chain.
      channel.panner.disconnect()
      disposeInserts(channel)
      channel.inserts = nodes
      connectEffectChain(channel.panner, nodes, channel.gate)
    },
    setMasterGain(gainDb) {
      masterGain.gain.value = dbToGain(gainDb)
    },
    setLimiter(enabled, thresholdDb) {
      limiter.threshold.value = thresholdDb
      if (enabled !== limiterEnabled) {
        limiterEnabled = enabled
        wireMaster()
      }
    },
    output,
    dispose() {
      for (const channel of channels.values()) disposeChannelNodes(channel)
      channels.clear()
      limiter.dispose()
      masterGain.dispose()
      output.dispose()
    },
  }
}
