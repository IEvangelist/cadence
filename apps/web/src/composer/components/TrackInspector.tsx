import { useRef, useState } from 'react'
import type { ComposerController } from '../hooks/useComposer'
import type { InstrumentDefinition } from '../plugins/types'
import { getInstrument } from '../instruments/registry'
import { InstrumentBrowser } from './InstrumentBrowser'
import './EditorWorkspace.css'

interface TrackInspectorProps {
  controller: ComposerController
  getInstruments?: () => InstrumentDefinition[]
  subscribeInstruments?: (listener: () => void) => () => void
}

export function TrackInspector({
  controller,
  getInstruments,
  subscribeInstruments,
}: TrackInspectorProps) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const browserTriggerRef = useRef<HTMLButtonElement>(null)
  const track =
    controller.project.tracks.find((candidate) => candidate.id === controller.selectedTrackId)
    ?? controller.project.tracks[0]

  if (!track) {
    return (
      <section className="track-inspector" aria-label="Track inspector">
        <p>No track selected.</p>
      </section>
    )
  }

  const instrument = getInstrument(track.instrumentId)

  return (
    <section className="track-inspector" aria-label="Track inspector">
      <header className="track-inspector__header">
        <span className="track-inspector__swatch" style={{ background: track.color }} aria-hidden="true" />
        <div>
          <h2>{track.name}</h2>
          <p>{instrument.group ?? (instrument.kind === 'drum' ? 'Drums' : 'Instrument')}</p>
        </div>
      </header>

      <label htmlFor={`track-name-${track.id}`}>Track name</label>
      <input
        id={`track-name-${track.id}`}
        data-interaction="studio.track.name"
        value={track.name}
        onChange={(event) => controller.renameTrack(track.id, event.target.value)}
        onBlur={controller.stopHistoryCapture}
      />

      <div className="track-inspector__instrument">
        <span>Instrument</span>
        <strong>{instrument.name}</strong>
        <p>{instrument.description}</p>
        <button
          ref={browserTriggerRef}
          type="button"
          className="btn"
          data-interaction="studio.track.instrument"
          aria-expanded={browserOpen}
          onClick={() => setBrowserOpen(true)}
        >
          Choose instrument for {track.name}
        </button>
      </div>

      {controller.project.tracks.length > 1 ? (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            controller.setAllTracksVisible(
              !controller.project.tracks.every((candidate) =>
                controller.visibleTrackIds.includes(candidate.id),
              ),
            )
          }
        >
          {controller.project.tracks.every((candidate) =>
            controller.visibleTrackIds.includes(candidate.id),
          )
            ? 'Show only selected'
            : 'Show all tracks'}
        </button>
      ) : null}

      {browserOpen ? (
        <InstrumentBrowser
          selectedId={track.instrumentId}
          onSelect={(instrumentId) => controller.setInstrument(track.id, instrumentId)}
          onClose={() => setBrowserOpen(false)}
          returnFocusRef={browserTriggerRef}
          {...(getInstruments ? { getInstruments } : {})}
          {...(subscribeInstruments ? { subscribe: subscribeInstruments } : {})}
        />
      ) : null}
    </section>
  )
}
