import * as Popover from '@radix-ui/react-popover'
import { type ComposerController } from '../hooks/useComposer'

interface MidiControlsProps {
  controller: ComposerController
}

/**
 * Live MIDI hardware controls (#111): a device selector, a record-arm toggle, an
 * opt-in quantize checkbox, and a connection indicator.
 *
 * When Web MIDI is unsupported (Firefox/Safari, SSR, jsdom) the whole surface
 * collapses to a single disabled hint and touches no MIDI APIs, so the app never
 * blocks on MIDI and degrades gracefully.
 */
export function MidiControls({ controller }: MidiControlsProps) {
  const { midi } = controller

  if (!midi.supported) {
    return (
      <div
        className="midi-controls midi-controls-unsupported"
        data-testid="midi-controls"
      >
        <span className="midi-indicator" data-state="unsupported" aria-hidden="true" />
        <span className="midi-unsupported-note">MIDI input is not supported in this browser</span>
      </div>
    )
  }

  const hasDevice = midi.inputs.length > 0
  const state = midi.armed && midi.connected ? 'recording' : midi.connected ? 'connected' : 'idle'
  const stateLabel =
    state === 'recording'
      ? 'Recording armed, MIDI device connected'
      : state === 'connected'
        ? 'MIDI device connected'
        : 'No MIDI device connected'

  return (
    <div className="midi-controls" data-testid="midi-controls">
      <span
        className="midi-indicator"
        data-state={state}
        role="status"
        aria-label={stateLabel}
        title={stateLabel}
      />
      <button
        type="button"
        className="btn btn-sm btn-toggle midi-arm"
        data-interaction="studio.midi.arm"
        aria-pressed={midi.armed}
        onClick={midi.toggleArmed}
        title="Record notes played on the MIDI device into the selected track"
      >
        Record
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn btn-sm"
            data-interaction="studio.midi.settings"
          >
            MIDI
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="midi-settings" align="center" sideOffset={8}>
            <label className="field">
              <span>Device</span>
              <select
                className="midi-select"
                data-interaction="studio.midi.device"
                aria-label="MIDI device"
                value={midi.selectedInputId ?? ''}
                onChange={(event) => midi.selectInput(event.target.value || null)}
                disabled={!hasDevice}
              >
                {hasDevice ? (
                  midi.inputs.map((input) => (
                    <option key={input.id} value={input.id}>
                      {input.name}
                    </option>
                  ))
                ) : (
                  <option value="">No MIDI devices</option>
                )}
              </select>
            </label>
            <label className="field midi-quantize">
              <input
                type="checkbox"
                data-interaction="studio.midi.quantize"
                checked={midi.quantize}
                onChange={(event) => midi.setQuantize(event.target.checked)}
              />
              <span>Quantize while recording</span>
            </label>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
