/**
 * Offline (non-realtime) render of a project to raw audio, using Tone.js's
 * `Tone.Offline` (which wraps `OfflineAudioContext`). This is the only piece of
 * the audio-export path that needs a real Web Audio implementation, so it lives
 * behind the injectable `OfflineRenderer` seam in `formats/audioExport.ts` and is
 * excluded from unit coverage (exercised via the browser/e2e path instead).
 *
 * Voice construction is delegated to each instrument's registered `createVoice`
 * factory (the same seam `audio/engine.ts` uses for realtime playback), so an
 * export sounds like playback for every instrument — built-in or plugin — with
 * no per-instrument special-casing here.
 */
import * as Tone from 'tone'
import { type Project, type Track } from '../model/project'
import { getInstrumentContribution } from '../instruments/registry'
import { type InstrumentVoice } from '../plugins/types'
import { beatsToSeconds } from '../timing/timing'
import { type RenderedAudio } from '../formats/audioExport'

function createOfflineVoice(track: Track, tempo: number): InstrumentVoice {
  // A per-track output routed to the offline destination, mirroring the realtime
  // engine's per-track gain so voices connect somewhere real.
  const output = new Tone.Gain(1).toDestination()
  return getInstrumentContribution(track.instrumentId).createVoice({
    output,
    track,
    tempo,
  })
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
        const voice = createOfflineVoice(track, project.tempo)
        for (const note of track.notes) {
          const start = beatsToSeconds(note.start, project.tempo)
          const duration = beatsToSeconds(note.duration, project.tempo)
          voice.trigger(note.pitch, duration, start, note.velocity)
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
