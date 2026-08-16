import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ComposerController } from '../hooks/useComposer'
import type { Track } from '../model/project'
import { getInstrument } from '../instruments/registry'
import { trackRequiresDeleteConfirmation } from './trackRailModel'
import './EditorWorkspace.css'

interface TrackRailProps {
  controller: ComposerController
  renderTrailing?: (track: Track) => ReactNode
}

export function TrackRail({
  controller,
  renderTrailing,
}: TrackRailProps) {
  const {
    project,
    selectedTrackId,
    selectTrack,
    toggleMute,
    addTrack,
    removeTrack,
    visibleTrackIds,
    toggleTrackVisibility,
    setAllTracksVisible,
  } = controller
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const visible = new Set(visibleTrackIds)
  const allVisible = project.tracks.every((track) => visible.has(track.id))
  const pendingTrack = project.tracks.find((track) => track.id === pendingDeleteId)
  useEffect(() => {
    if (pendingTrack) cancelRef.current?.focus()
  }, [pendingTrack])

  const cancelDelete = (): void => {
    setPendingDeleteId(null)
    queueMicrotask(() => deleteTriggerRef.current?.focus())
  }

  const requestDelete = (track: Track, trigger: HTMLButtonElement): void => {
    if (trackRequiresDeleteConfirmation(controller, track)) {
      deleteTriggerRef.current = trigger
      setPendingDeleteId(track.id)
      return
    }
    removeTrack(track.id)
  }

  return (
    <section className="track-rail" aria-label="Tracks">
      <header className="track-rail__header">
        <h2>Tracks</h2>
        <div className="track-rail__header-actions">
          {project.tracks.length > 1 ? (
            <button
              type="button"
              className={`btn btn-sm${allVisible ? ' is-active' : ''}`}
              data-interaction="studio.track.visibility-all"
              aria-pressed={allVisible}
              onClick={() => setAllTracksVisible(!allVisible)}
            >
              {allVisible ? 'Show only selected' : 'Show all tracks'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.track.add"
            onClick={addTrack}
          >
            Add track
          </button>
        </div>
      </header>
      <ol className="track-rail__list">
        {project.tracks.map((track) => {
          const selected = track.id === selectedTrackId
          const shown = visible.has(track.id)
          return (
            <li
              key={track.id}
              className={`track-rail__row${selected ? ' is-selected' : ''}`}
              style={{ '--track-color': track.color } as CSSProperties}
            >
              <button
                type="button"
                className="track-rail__select"
                data-interaction="studio.track.select"
                aria-pressed={selected}
                aria-label={`${selected ? 'Selected' : 'Select'} ${track.name}`}
                onClick={() => selectTrack(track.id)}
              >
                <span className="track-rail__swatch" aria-hidden="true" />
                <span>
                  <strong>{track.name}</strong>
                  <small>{getInstrument(track.instrumentId).name}</small>
                </span>
              </button>
              <div className="track-rail__controls">
                <button
                  type="button"
                  className={`btn btn-sm${track.muted ? ' is-active' : ''}`}
                  data-interaction="studio.track.mute"
                  aria-pressed={track.muted}
                  aria-label={`${track.muted ? 'Muted' : 'Mute'} ${track.name}`}
                  onClick={() => toggleMute(track.id)}
                >
                  M
                </button>
                <button
                  type="button"
                  className={`btn btn-sm${shown ? ' is-active' : ''}`}
                  data-interaction="studio.track.visibility"
                  aria-pressed={shown}
                  disabled={selected}
                  aria-label={
                    selected
                      ? `${track.name} is shown on the piano roll as the edited track`
                      : `${shown ? 'Hide' : 'Show'} ${track.name} on the piano roll`
                  }
                  onClick={() => toggleTrackVisibility(track.id)}
                >
                  Roll
                </button>
                {renderTrailing?.(track)}
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  data-interaction="studio.track.delete"
                  disabled={project.tracks.length <= 1}
                  aria-label={`Delete ${track.name}`}
                  onClick={(event) => requestDelete(track, event.currentTarget)}
                >
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      {pendingTrack ? (
        <div
          className="track-delete-dialog"
          role="alertdialog"
          data-interaction="studio.track.delete.dialog"
          aria-modal="true"
          aria-labelledby="track-delete-title"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelDelete()
            }
          }}
        >
          <h2 id="track-delete-title">Delete {pendingTrack.name}?</h2>
          <p>This removes its notes, automation, and mix settings.</p>
          <div>
            <button
              ref={cancelRef}
              type="button"
              className="btn btn-danger"
              data-interaction="studio.track.delete.confirm"
              onClick={() => {
                removeTrack(pendingTrack.id)
                setPendingDeleteId(null)
              }}
            >
              Delete track
            </button>
            <button
              type="button"
              className="btn"
              data-interaction="studio.track.delete.cancel"
              onClick={cancelDelete}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
