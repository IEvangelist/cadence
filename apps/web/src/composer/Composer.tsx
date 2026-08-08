import { type UseComposerOptions, useComposer } from './hooks/useComposer'
import { ProjectToolbar } from './components/ProjectToolbar'
import { TransportBar } from './components/TransportBar'
import { TrackPanel } from './components/TrackPanel'
import { PianoRoll } from './components/PianoRoll'
import './Composer.css'

interface ComposerProps {
  /** Injectable engine/store/project — used by tests; defaults power the app. */
  options?: UseComposerOptions
}

/** The flagship composing surface: toolbar, transport, tracks, and piano roll. */
export function Composer({ options }: ComposerProps = {}) {
  const controller = useComposer(options)
  const { project, audioReady, loadDemo } = controller
  const isEmpty = project.tracks.every((track) => track.notes.length === 0)

  return (
    <section className="composer" aria-label="Composer">
      <ProjectToolbar controller={controller} />
      <TransportBar controller={controller} />

      {isEmpty && (
        <div className="composer-empty">
          <p className="composer-empty-title">Your canvas is empty.</p>
          <p className="composer-empty-hint">
            Click the grid to place a note, or start from a ready-made idea.
          </p>
          <button type="button" className="btn btn-primary" onClick={loadDemo}>
            Load a demo pattern
          </button>
        </div>
      )}

      <div className="composer-body">
        <TrackPanel controller={controller} />
        <PianoRoll controller={controller} />
      </div>

      {!audioReady && (
        <p className="audio-note" role="note">
          Audio output isn’t available in this environment — editing, saving, and MIDI export
          still work.
        </p>
      )}
    </section>
  )
}
