import { type ComposerController } from '../hooks/useComposer'
import { InstrumentPicker } from './InstrumentPicker'

interface TrackPanelProps {
  controller: ComposerController
}

/** The track list: select, rename, mute, choose instrument, add/remove tracks. */
export function TrackPanel({ controller }: TrackPanelProps) {
  const {
    project,
    selectedTrackId,
    selectTrack,
    renameTrack,
    toggleMute,
    setInstrument,
    addTrack,
    removeTrack,
    visibleTrackIds,
    toggleTrackVisibility,
    setAllTracksVisible,
  } = controller

  const visibleSet = new Set(visibleTrackIds)
  const allVisible =
    project.tracks.length > 0 && project.tracks.every((t) => visibleSet.has(t.id))

  return (
    <section className="track-panel" aria-label="Tracks">
      <header className="panel-header">
        <h3>Tracks</h3>
        <div className="track-panel-actions">
          {project.tracks.length > 1 && (
            <button
              type="button"
              className={`btn btn-sm${allVisible ? ' is-active' : ''}`}
              aria-pressed={allVisible}
              onClick={() => setAllTracksVisible(!allVisible)}
            >
              {allVisible ? 'Show only selected' : 'Show all tracks'}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={addTrack}>
            + Add track
          </button>
        </div>
      </header>
      <ul className="track-list">
        {project.tracks.map((track) => {
          const selected = track.id === selectedTrackId
          const visible = visibleSet.has(track.id)
          return (
            <li
              key={track.id}
              className={`track-item${selected ? ' is-selected' : ''}`}
              style={{ borderColor: track.color }}
            >
              <button
                type="button"
                className="track-select"
                aria-pressed={selected}
                onClick={() => selectTrack(track.id)}
              >
                <span className="track-swatch" style={{ background: track.color }} aria-hidden="true" />
                {selected ? 'Selected: ' : 'Select '}
                {track.name}
              </button>
              <label className="visually-hidden" htmlFor={`name-${track.id}`}>
                Track name
              </label>
              <input
                id={`name-${track.id}`}
                className="track-name"
                value={track.name}
                onChange={(event) => renameTrack(track.id, event.target.value)}
              />
              <InstrumentPicker
                value={track.instrumentId}
                onChange={(id) => setInstrument(track.id, id)}
                label={`Instrument for ${track.name}`}
              />
              <button
                type="button"
                className={`btn btn-sm${visible ? ' is-active' : ''}`}
                aria-pressed={visible}
                disabled={selected}
                onClick={() => toggleTrackVisibility(track.id)}
                aria-label={
                  selected
                    ? `${track.name} is shown on the piano roll — the track being edited`
                    : visible
                      ? `Hide ${track.name} from the piano roll`
                      : `Show ${track.name} on the piano roll`
                }
                title="Show on piano roll"
              >
                {visible ? 'On roll' : 'Show'}
              </button>
              <button
                type="button"
                className={`btn btn-sm${track.muted ? ' is-active' : ''}`}
                aria-pressed={track.muted}
                onClick={() => toggleMute(track.id)}
              >
                {track.muted ? 'Muted' : 'Mute'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => removeTrack(track.id)}
                disabled={project.tracks.length <= 1}
                aria-label={`Delete ${track.name}`}
              >
                ✕
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
