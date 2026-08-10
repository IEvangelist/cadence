import type { AiStudioController } from '../hooks/useAiStudio'
import type { AiFeatureId } from '../ai/expanded'
import { GROOVE_PRESETS, MOTIF_LENGTH_RANGE, STYLES } from '../ai/expanded'

interface AiStudioPanelProps {
  studio: AiStudioController
}

const FEATURES: Array<{ value: AiFeatureId; label: string; hint: string }> = [
  { value: 'text-to-motif', label: 'Text to motif', hint: 'Turn a text prompt into a melodic idea' },
  { value: 'style-transfer', label: 'Style transfer', hint: 'Reinterpret the track in a new style' },
  { value: 'groove', label: 'Groove & humanize', hint: 'Add swing and a played-in feel' },
  { value: 'auto-master', label: 'Auto-master', hint: 'Analyze the mix and suggest fixes' },
]

/** Format a signed decibel value for display, e.g. `+2.3 dB`, `-1.0 dB`, `0.0 dB`. */
const formatDb = (db: number): string => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`

/**
 * The expanded-AI "AI Studio" panel: pick a feature, tweak its controls, and run
 * it. Pro-only features stay visible but locked on the free tier with an upgrade
 * hint. Mirrors the Assistant panel's proven accessible structure (fieldset +
 * legend, radiogroup, labelled controls, polite status region) so it stays
 * axe-clean on the always-visible home page.
 */
export function AiStudioPanel({ studio }: AiStudioPanelProps) {
  const {
    unlimited,
    feature,
    setFeature,
    canUse,
    prompt,
    setPrompt,
    motifLength,
    setMotifLength,
    createMotif,
    styleId,
    setStyleId,
    applyStyleToTrack,
    groovePresetId,
    setGroovePresetId,
    grooveIntensity,
    setGrooveIntensity,
    applyGrooveToTrack,
    report,
    analyze,
    status,
  } = studio

  const locked = !canUse(feature)

  return (
    <section className="ai-studio-panel" aria-label="AI Studio">
      <header className="panel-header">
        <h3>AI Studio</h3>
        <span className="assistant-badge">{unlimited ? 'Pro' : 'Free'} · on-device</span>
      </header>

      <fieldset className="ai-studio-fieldset">
        <legend>Feature</legend>
        <div className="ai-studio-features" role="radiogroup" aria-label="AI Studio feature">
          {FEATURES.map((item) => (
            <label key={item.value} className="ai-studio-radio">
              <input
                type="radio"
                name="ai-studio-feature"
                value={item.value}
                checked={feature === item.value}
                onChange={() => setFeature(item.value)}
              />
              <span className="ai-studio-radio-label">
                {item.label}
                {!canUse(item.value) && <span className="ai-studio-lock"> · Pro</span>}
              </span>
              <span className="ai-studio-radio-hint">{item.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {feature === 'text-to-motif' && (
        <div className="ai-studio-controls">
          <label className="field">
            <span>Prompt</span>
            <input
              type="text"
              className="ai-studio-prompt"
              value={prompt}
              placeholder="e.g. dreamy lo-fi melody in D minor"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <label className="field field-grow">
            <span>Motif length</span>
            <input
              type="range"
              min={MOTIF_LENGTH_RANGE.min}
              max={MOTIF_LENGTH_RANGE.max}
              step={MOTIF_LENGTH_RANGE.step}
              value={motifLength}
              onChange={(event) => setMotifLength(Number(event.target.value))}
            />
            <span className="field-suffix">{motifLength} beats</span>
          </label>
          <button type="button" className="btn btn-primary" onClick={createMotif}>
            Create motif
          </button>
        </div>
      )}

      {feature === 'style-transfer' && (
        <div className="ai-studio-controls">
          <label className="field">
            <span>Style</span>
            <select
              className="ai-studio-select"
              value={styleId}
              disabled={locked}
              onChange={(event) => setStyleId(event.target.value as typeof styleId)}
            >
              {STYLES.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
          </label>
          <p className="ai-studio-hint">{STYLES.find((s) => s.id === styleId)?.description}</p>
          <button type="button" className="btn btn-primary" onClick={applyStyleToTrack} disabled={locked}>
            Apply style
          </button>
        </div>
      )}

      {feature === 'groove' && (
        <div className="ai-studio-controls">
          <label className="field">
            <span>Groove</span>
            <select
              className="ai-studio-select"
              value={groovePresetId}
              onChange={(event) => setGroovePresetId(event.target.value as typeof groovePresetId)}
            >
              {GROOVE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-grow">
            <span>Intensity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={grooveIntensity}
              onChange={(event) => setGrooveIntensity(Number(event.target.value))}
            />
            <span className="field-suffix">{Math.round(grooveIntensity * 100)}%</span>
          </label>
          <button type="button" className="btn btn-primary" onClick={applyGrooveToTrack}>
            Apply groove
          </button>
        </div>
      )}

      {feature === 'auto-master' && (
        <div className="ai-studio-controls">
          <button type="button" className="btn btn-primary" onClick={analyze} disabled={locked}>
            Analyze mix
          </button>
          {report && (
            <div className="ai-studio-report">
              <p className="ai-studio-report-summary">{report.summary}</p>
              <dl className="ai-studio-directive">
                <dt>Master gain</dt>
                <dd>{formatDb(report.suggestion.masterGainDb)}</dd>
                <dt>Limiter ceiling</dt>
                <dd>{formatDb(report.suggestion.limiterThresholdDb)}</dd>
              </dl>
              <p className="ai-studio-directive-rationale">{report.suggestion.rationale}</p>
              {report.advisories.length > 0 && (
                <ul className="ai-studio-suggestions">
                  {report.advisories.map((advisory) => (
                    <li
                      key={advisory.id}
                      className={`ai-studio-suggestion ai-studio-sev-${advisory.severity}`}
                    >
                      <span className="ai-studio-suggestion-title">{advisory.title}</span>
                      <span className="ai-studio-suggestion-detail">{advisory.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {locked && (
        <p className="ai-studio-upgrade">
          {FEATURES.find((f) => f.value === feature)?.label} is available on the Pro plan.
        </p>
      )}

      <p className="ai-studio-status" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  )
}
