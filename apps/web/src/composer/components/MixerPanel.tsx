import { useState } from 'react'
import type { MixerViewModel } from '../hooks/useMixer'

interface MixerPanelProps {
  mixer: MixerViewModel
}

/** Format a signed decibel value, e.g. `+2.5 dB`, `-6.0 dB`, `0.0 dB`. */
const formatDb = (db: number): string => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`

/** Format a pan position as `C`, `L42`, or `R80`. */
const formatPan = (pan: number): string => {
  if (Math.abs(pan) < 0.005) return 'C'
  return `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`
}

const GAIN_MIN = -60
const GAIN_MAX = 6
const THRESHOLD_MIN = -60
const THRESHOLD_MAX = 0

/**
 * The #44 Mixer panel: per-track strips (gain / pan / mute / solo + insert
 * effects), a master bus (gain + limiter), and compact "write at playhead"
 * automation. Mirrors the AI Studio panel's accessible structure (fieldset +
 * legend, labelled sliders, pressed-state buttons, polite status region) so it
 * stays axe-clean on the always-visible home page. It is presentational — every
 * action flows through the {@link MixerViewModel} from `useMixer`.
 */
export function MixerPanel({ mixer }: MixerPanelProps) {
  const {
    tracks,
    master,
    masterAutomated,
    availableEffects,
    effectName,
    setTrackGain,
    setTrackPan,
    toggleSolo,
    toggleMute,
    addInsert,
    removeInsert,
    toggleInsert,
    setMasterGain,
    setLimiterEnabled,
    setLimiterThreshold,
    writeTrackGainAutomation,
    writeTrackPanAutomation,
    clearTrackAutomation,
    writeMasterGainAutomation,
    clearMasterAutomation,
  } = mixer

  // Per-track "add insert" selection (defaults to the first available effect).
  const [pendingInsert, setPendingInsert] = useState<Record<string, string>>({})
  const defaultEffectId = availableEffects[0]?.id ?? ''
  const selectionFor = (trackId: string): string => pendingInsert[trackId] ?? defaultEffectId

  return (
    <section className="mixer-panel" aria-label="Mixer">
      <header className="panel-header">
        <h3>Mixer</h3>
        <span className="assistant-badge">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
        </span>
      </header>

      <div className="mixer-tracks">
        {tracks.map((track) => (
          <fieldset className="mixer-strip" key={track.id}>
            <legend>
              <span className="mixer-swatch" style={{ backgroundColor: track.color }} aria-hidden="true" />
              {track.name}
            </legend>

            <label className="field field-grow">
              <span>Gain</span>
              <input
                type="range"
                min={GAIN_MIN}
                max={GAIN_MAX}
                step={0.5}
                value={track.gainDb}
                onChange={(event) => setTrackGain(track.id, Number(event.target.value))}
              />
              <span className="field-suffix">{formatDb(track.gainDb)}</span>
            </label>

            <label className="field field-grow">
              <span>Pan</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.02}
                value={track.pan}
                onChange={(event) => setTrackPan(track.id, Number(event.target.value))}
              />
              <span className="field-suffix">{formatPan(track.pan)}</span>
            </label>

            <div className="mixer-strip-buttons">
              <button
                type="button"
                className="btn btn-toggle"
                aria-pressed={track.muted}
                onClick={() => toggleMute(track.id)}
              >
                Mute
              </button>
              <button
                type="button"
                className="btn btn-toggle"
                aria-pressed={track.solo}
                onClick={() => toggleSolo(track.id)}
              >
                Solo
              </button>
            </div>

            <div className="mixer-inserts">
              <span className="mixer-inserts-title">Inserts</span>
              {track.inserts.length > 0 && (
                <ul className="mixer-insert-list">
                  {track.inserts.map((insert) => (
                    <li key={insert.id} className="mixer-insert">
                      <label className="mixer-insert-toggle">
                        <input
                          type="checkbox"
                          checked={insert.enabled}
                          onChange={() => toggleInsert(track.id, insert.id)}
                        />
                        <span>{effectName(insert.effectId)}</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label={`Remove ${effectName(insert.effectId)} from ${track.name}`}
                        onClick={() => removeInsert(track.id, insert.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mixer-add-insert">
                <label className="field">
                  <span className="visually-hidden">Add insert to {track.name}</span>
                  <select
                    value={selectionFor(track.id)}
                    onChange={(event) =>
                      setPendingInsert((prev) => ({ ...prev, [track.id]: event.target.value }))
                    }
                  >
                    {availableEffects.map((effect) => (
                      <option key={effect.id} value={effect.id}>
                        {effect.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={availableEffects.length === 0}
                  onClick={() => addInsert(track.id, selectionFor(track.id))}
                >
                  Add
                </button>
              </div>
            </div>

            <div className="mixer-automation">
              <span className="mixer-automation-title">Automation</span>
              <div className="mixer-automation-buttons">
                <button type="button" className="btn btn-ghost" onClick={() => writeTrackGainAutomation(track.id)}>
                  Gain @ playhead
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => writeTrackPanAutomation(track.id)}>
                  Pan @ playhead
                </button>
                {track.automated && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => clearTrackAutomation(track.id)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </fieldset>
        ))}
      </div>

      <fieldset className="mixer-master">
        <legend>Master bus</legend>
        <label className="field field-grow">
          <span>Gain</span>
          <input
            type="range"
            min={GAIN_MIN}
            max={GAIN_MAX}
            step={0.5}
            value={master.gainDb}
            onChange={(event) => setMasterGain(Number(event.target.value))}
          />
          <span className="field-suffix">{formatDb(master.gainDb)}</span>
        </label>

        <label className="mixer-insert-toggle">
          <input
            type="checkbox"
            checked={master.limiterEnabled}
            onChange={(event) => setLimiterEnabled(event.target.checked)}
          />
          <span>Limiter</span>
        </label>

        <label className="field field-grow">
          <span>Ceiling</span>
          <input
            type="range"
            min={THRESHOLD_MIN}
            max={THRESHOLD_MAX}
            step={0.5}
            value={master.limiterThresholdDb}
            disabled={!master.limiterEnabled}
            onChange={(event) => setLimiterThreshold(Number(event.target.value))}
          />
          <span className="field-suffix">{formatDb(master.limiterThresholdDb)}</span>
        </label>

        <div className="mixer-automation">
          <span className="mixer-automation-title">Automation</span>
          <div className="mixer-automation-buttons">
            <button type="button" className="btn btn-ghost" onClick={writeMasterGainAutomation}>
              Gain @ playhead
            </button>
            {masterAutomated && (
              <button type="button" className="btn btn-ghost" onClick={clearMasterAutomation}>
                Clear
              </button>
            )}
          </div>
        </div>
      </fieldset>

      <p className="mixer-status" role="status" aria-live="polite">
        {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · master {formatDb(master.gainDb)}
        {master.limiterEnabled ? ` · limiter ${formatDb(master.limiterThresholdDb)}` : ''}
      </p>
    </section>
  )
}
