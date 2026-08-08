import { type ComposerController } from '../hooks/useComposer'
import { SNAP_OPTIONS, beatsToBarsBeatsSixteenths } from '../timing/timing'

interface TransportBarProps {
  controller: ComposerController
}

/** Play/pause/stop, tempo, loop, snap, and a live position readout. */
export function TransportBar({ controller }: TransportBarProps) {
  const {
    transportState,
    togglePlay,
    stop,
    project,
    setTempo,
    toggleLoop,
    snap,
    setSnap,
    positionBeats,
  } = controller
  const isPlaying = transportState === 'playing'

  return (
    <div className="transport" role="group" aria-label="Transport controls">
      <button
        type="button"
        className="btn btn-primary transport-play"
        onClick={togglePlay}
        aria-pressed={isPlaying}
      >
        {isPlaying ? '❚❚ Pause' : '▶ Play'}
      </button>
      <button type="button" className="btn" onClick={stop}>
        ■ Stop
      </button>

      <label className="field">
        <span>Tempo</span>
        <input
          type="number"
          className="tempo-input"
          min={20}
          max={300}
          value={project.tempo}
          onChange={(event) => setTempo(Number(event.target.value))}
          aria-label="Tempo"
        />
        <span className="field-suffix">BPM</span>
      </label>

      <button
        type="button"
        className="btn"
        onClick={toggleLoop}
        aria-pressed={project.loop.enabled}
      >
        ↻ Loop
      </button>

      <label className="field">
        <span>Snap</span>
        <select
          className="snap-select"
          value={snap}
          onChange={(event) => setSnap(Number(event.target.value))}
          aria-label="Snap"
        >
          {SNAP_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <output className="position" aria-label="Playhead position">
        {beatsToBarsBeatsSixteenths(positionBeats)}
      </output>
    </div>
  )
}
