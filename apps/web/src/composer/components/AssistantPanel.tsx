import type { AssistantController } from '../hooks/useAssistant'
import type { AssistantAction } from '../ai/types'
import { LENGTH_RANGE, TEMPERATURE_RANGE } from '../ai/types'

interface AssistantPanelProps {
  assistant: AssistantController
}

const ACTIONS: Array<{ value: AssistantAction; label: string; hint: string }> = [
  { value: 'continue', label: 'Continue melody', hint: 'Extend the selected track from its last notes' },
  { value: 'generate', label: 'Generate melody', hint: 'Create a fresh melodic idea' },
  { value: 'harmonize', label: 'Harmonize', hint: 'Suggest chords under the melody' },
]

/**
 * The brand-themed AI Assistant panel. Pick an action + parameters, Generate,
 * preview the suggestion (auditioned via the audio engine and shown as ghost
 * notes in the piano roll), then Accept (inserts through the reducer) or Discard.
 * Fully keyboard-operable and axe-clean.
 */
export function AssistantPanel({ assistant }: AssistantPanelProps) {
  const {
    action,
    setAction,
    params,
    setTemperature,
    setLength,
    statusMessage,
    isBusy,
    suggestion,
    canGenerate,
    generate,
    cancel,
    accept,
    discard,
    audition,
  } = assistant

  const paramsDisabled = action === 'harmonize'

  return (
    <section className="assistant-panel" aria-label="AI Assistant">
      <header className="panel-header">
        <h3>Assistant</h3>
        <span className="assistant-badge">Free · on-device</span>
      </header>

      <fieldset className="assistant-fieldset">
        <legend>Action</legend>
        <div className="assistant-actions-group" role="radiogroup" aria-label="Assistant action">
          {ACTIONS.map((item) => (
            <label key={item.value} className="assistant-radio">
              <input
                type="radio"
                name="assistant-action"
                value={item.value}
                checked={action === item.value}
                disabled={isBusy}
                onChange={() => setAction(item.value)}
              />
              <span className="assistant-radio-label">{item.label}</span>
              <span className="assistant-radio-hint">{item.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="assistant-params">
        <label className="field field-grow">
          <span>Temperature</span>
          <input
            type="range"
            min={TEMPERATURE_RANGE.min}
            max={TEMPERATURE_RANGE.max}
            step={TEMPERATURE_RANGE.step}
            value={params.temperature}
            disabled={paramsDisabled || isBusy}
            onChange={(event) => setTemperature(Number(event.target.value))}
          />
          <span className="field-suffix">{params.temperature.toFixed(1)}</span>
        </label>

        <label className="field field-grow">
          <span>Length (beats)</span>
          <input
            type="range"
            min={LENGTH_RANGE.min}
            max={LENGTH_RANGE.max}
            step={LENGTH_RANGE.step}
            value={params.lengthBeats}
            disabled={paramsDisabled || isBusy}
            onChange={(event) => setLength(Number(event.target.value))}
          />
          <span className="field-suffix">{params.lengthBeats}</span>
        </label>
      </div>

      <div className="assistant-actions">
        {isBusy ? (
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void generate()}
            disabled={!canGenerate}
          >
            Generate
          </button>
        )}
      </div>

      <p className="assistant-status" role="status" aria-live="polite">
        {isBusy && <span className="assistant-spinner" aria-hidden="true" />}
        {statusMessage}
      </p>

      {suggestion && (
        <div className="assistant-suggestion">
          <p className="assistant-suggestion-note">
            Preview is shown as highlighted notes in the piano roll.
          </p>
          <div className="assistant-actions">
            <button type="button" className="btn btn-sm" onClick={audition}>
              Preview
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={accept}>
              Accept
            </button>
            <button type="button" className="btn btn-sm" onClick={discard}>
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
