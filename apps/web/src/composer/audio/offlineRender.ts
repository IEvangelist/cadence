/**
 * Offline (non-realtime) render of a project to raw audio, using Tone.js's
 * `Tone.Offline` (which wraps `OfflineAudioContext`). This is the only piece of
 * the audio-export path that needs a real Web Audio implementation, so it lives
 * behind the injectable `OfflineRenderer` seam in `formats/audioExport.ts` and is
 * excluded from unit coverage (exercised via the browser/e2e path instead).
 *
 * Voice construction mirrors `audio/engine.ts` (poly/FM synths + a simple
 * kick/noise drum kit) so an export sounds like playback.
 */
import * as Tone from 'tone'
import { type Project, type Track, pitchToName } from '../model/project'
import { getInstrument } from '../instruments/registry'
import { beatsToSeconds } from '../timing/timing'
import { type RenderedAudio } from '../formats/audioExport'

type Trigger = (pitch: number, durationSeconds: number, time: number, velocity: number) => void

function createOfflineVoice(track: Track): Trigger {
  const def = getInstrument(track.instrumentId)
  if (def.kind === 'drum') {
    const kick = new Tone.MembraneSynth().toDestination()
    const noise = new Tone.NoiseSynth().toDestination()
    return (pitch, duration, time, velocity) => {
      if (pitch <= 36) kick.triggerAttackRelease('C1', duration, time, velocity)
      else noise.triggerAttackRelease(duration, time, velocity)
    }
  }
  const synth =
    track.instrumentId === 'fm-synth'
      ? new Tone.PolySynth(Tone.FMSynth).toDestination()
      : new Tone.PolySynth(Tone.Synth).toDestination()
  synth.volume.value = -8
  return (pitch, duration, time, velocity) => {
    synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
  }
}

/** Render a project offline and return its raw channel data. */
export async function renderProjectOffline(
  project: Project,
  durationSeconds: number,
  sampleRate: number,
): Promise<RenderedAudio> {
  const buffer = await Tone.Offline(
    () => {
      for (const track of project.tracks) {
        if (track.muted || track.notes.length === 0) continue
        const trigger = createOfflineVoice(track)
        for (const note of track.notes) {
          const start = beatsToSeconds(note.start, project.tempo)
          const duration = beatsToSeconds(note.duration, project.tempo)
          trigger(note.pitch, duration, start, note.velocity)
        }
      }
    },
    Math.max(0.05, durationSeconds),
    2,
    sampleRate,
  )

  const channelCount = Math.max(1, buffer.numberOfChannels)
  const channels: Float32Array[] = []
  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(Float32Array.from(buffer.getChannelData(channel)))
  }
  return { sampleRate: buffer.sampleRate, channels }
}
