/**
 * useMidiInput — React adapter over the pure Web MIDI helpers.
 *
 * Owns the browser-side lifecycle: feature-detect, request access, enumerate
 * inputs, follow hot-plug (`statechange`), and subscribe to the selected input's
 * messages — decoding them through {@link parseMidiMessage} and forwarding
 * note/CC callbacks. It holds NO audio or project state; the composer controller
 * passes callbacks that route monitoring/recording through the existing seams.
 *
 * Everything is feature-detected: when Web MIDI is absent (Firefox/Safari, SSR,
 * jsdom) the hook reports `supported: false` and does nothing, so the UI can hide
 * or disable itself and app load is never blocked.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type MidiAccessLike,
  type MidiInputInfo,
  type MidiMessageLike,
  findInput,
  isWebMidiSupported,
  listInputs,
  parseMidiMessage,
  requestMidiAccess,
} from '../midi/webMidi'

export interface UseMidiInputOptions {
  /** Called on note-on with the MIDI note (0–127) and raw velocity (1–127). */
  onNoteOn?: (note: number, velocity: number) => void
  /** Called on note-off (including a note-on at velocity 0). */
  onNoteOff?: (note: number) => void
  /** Called on control-change messages. */
  onControlChange?: (controller: number, value: number) => void
  /** Master switch; when false the hook stays dormant. Defaults to true. */
  enabled?: boolean
  /** Injectable access request for tests/e2e; defaults to the navigator path. */
  requestAccess?: () => Promise<MidiAccessLike | null>
  /** Injectable navigator for feature detection in tests. */
  navigator?: Navigator
}

export interface MidiInputState {
  /** Whether Web MIDI exists in this runtime. */
  supported: boolean
  /** Whether access has been granted and inputs enumerated. */
  ready: boolean
  /** Currently available input devices. */
  inputs: MidiInputInfo[]
  /** The device the user picked (auto-set to the first when unset). */
  selectedInputId: string | null
  selectInput: (id: string | null) => void
  /** True when the selected device is present and receiving. */
  connected: boolean
}

export function useMidiInput(options: UseMidiInputOptions = {}): MidiInputState {
  const { enabled = true, requestAccess, navigator: navigatorOverride } = options

  // Injected access implies a testable/supported environment.
  const supported = requestAccess != null || isWebMidiSupported(navigatorOverride)

  const [ready, setReady] = useState(false)
  const [inputs, setInputs] = useState<MidiInputInfo[]>([])
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null)

  const accessRef = useRef<MidiAccessLike | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const runningStatusRef = useRef<number | null>(null)

  // Keep callbacks in refs so the message subscription never re-attaches on a
  // parent re-render (which would drop in-flight running status).
  const onNoteOnRef = useRef(options.onNoteOn)
  const onNoteOffRef = useRef(options.onNoteOff)
  const onControlChangeRef = useRef(options.onControlChange)
  useEffect(() => {
    onNoteOnRef.current = options.onNoteOn
    onNoteOffRef.current = options.onNoteOff
    onControlChangeRef.current = options.onControlChange
  })

  useEffect(() => {
    selectedIdRef.current = selectedInputId
  }, [selectedInputId])

  const selectInput = useCallback((id: string | null) => setSelectedInputId(id), [])

  // Acquire access once, then track hot-plug through `statechange`.
  useEffect(() => {
    if (!supported || !enabled) return
    let cancelled = false

    const refresh = (): void => {
      const access = accessRef.current
      if (!access) return
      const next = listInputs(access)
      setInputs(next)
      // Auto-select the first device only when the user hasn't chosen one, so a
      // controller "just works" on connect without stealing an explicit choice.
      if (selectedIdRef.current === null && next.length > 0) {
        setSelectedInputId(next[0].id)
      }
    }

    const acquire =
      requestAccess ?? (() => requestMidiAccess({ navigator: navigatorOverride }))
    void acquire().then((access) => {
      if (cancelled || !access) return
      accessRef.current = access
      access.onstatechange = refresh
      setReady(true)
      refresh()
    })

    return () => {
      cancelled = true
      const access = accessRef.current
      if (access) access.onstatechange = null
      accessRef.current = null
      setReady(false)
    }
  }, [supported, enabled, requestAccess, navigatorOverride])

  // Subscribe to the selected input's messages. Re-runs on hot-plug (`inputs`)
  // so a reconnected device re-attaches to its fresh port object.
  useEffect(() => {
    const access = accessRef.current
    if (!ready || !access || selectedInputId === null) return
    const input = findInput(access, selectedInputId)
    if (!input) return

    runningStatusRef.current = null
    const handler = (event: MidiMessageLike): void => {
      const { event: decoded, runningStatus } = parseMidiMessage(
        event.data,
        runningStatusRef.current,
      )
      runningStatusRef.current = runningStatus
      if (!decoded) return
      if (decoded.type === 'noteon') onNoteOnRef.current?.(decoded.note, decoded.velocity)
      else if (decoded.type === 'noteoff') onNoteOffRef.current?.(decoded.note)
      else onControlChangeRef.current?.(decoded.controller, decoded.value)
    }
    input.onmidimessage = handler

    return () => {
      if (input.onmidimessage === handler) input.onmidimessage = null
    }
  }, [ready, selectedInputId, inputs])

  const connected =
    selectedInputId !== null && inputs.some((input) => input.id === selectedInputId)

  return { supported, ready, inputs, selectedInputId, selectInput, connected }
}
