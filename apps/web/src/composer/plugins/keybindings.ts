/**
 * Keybinding helpers for contributed commands.
 *
 * Bindings use a small `mod+shift+key` grammar where `mod` is Ctrl on
 * Windows/Linux and ⌘ on macOS. These helpers are pure (no DOM/React) so the
 * parsing and dispatch-matching logic is trivially unit-testable; the React hook
 * wires them to a `keydown` listener.
 */
import type { CommandContribution } from './types'

const MODIFIER_ORDER = ['mod', 'alt', 'shift'] as const
const MODIFIER_KEYS = new Set(['control', 'meta', 'alt', 'shift'])

/** Rewrite a binding into canonical `mod+alt+shift+key` order (lower-cased). */
export function canonicalizeKeybinding(binding: string): string {
  const parts = binding
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  let mods = MODIFIER_ORDER.filter((m) => parts.includes(m))
  let key = parts.find((p) => !MODIFIER_ORDER.includes(p as (typeof MODIFIER_ORDER)[number]))
  if (mods.includes('shift') && key === '/') {
    mods = mods.filter((modifier) => modifier !== 'shift')
    key = '?'
  }
  return [...mods, ...(key ? [key] : [])].join('+')
}

/**
 * Turn a keyboard event into a canonical binding string, or `null` when only
 * modifier keys are held (so a bare Ctrl press never triggers a command).
 */
export function eventToKeybinding(event: {
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  key: string
}): string | null {
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase()
  if (MODIFIER_KEYS.has(key)) return null
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  // Printable symbols already encode Shift in `event.key` (`?`, `+`, etc.).
  if (event.shiftKey && (key.length !== 1 || /^[a-z0-9]$/i.test(key))) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

/**
 * Build a `canonicalBinding → commandId` lookup from the active commands and the
 * user's keybinding overrides (`commandId → binding`). Later commands win when
 * two share a binding.
 */
export function resolveKeybindingMap(
  commands: CommandContribution[],
  overrides: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const command of commands) {
    // `overrides` is a plain map keyed by untrusted command ids; only trust an
    // own entry so a command id that shadows an Object.prototype member can't read
    // an inherited value (which would be a function, not a binding string).
    const override = Object.hasOwn(overrides, command.id) ? overrides[command.id] : undefined
    const raw = override ?? command.keybinding
    if (!raw) continue
    map.set(canonicalizeKeybinding(raw), command.id)
  }
  return map
}

export type KeybindingPlatform = 'mac' | 'other'

export function detectKeybindingPlatform(
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
): KeybindingPlatform {
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'mac' : 'other'
}

/** Render a binding using platform labels without changing canonical storage. */
export function formatKeybinding(
  binding: string,
  platform: KeybindingPlatform = detectKeybindingPlatform(),
): string {
  return canonicalizeKeybinding(binding)
    .split('+')
    .map((part) =>
      part === 'mod'
        ? platform === 'mac'
          ? 'Cmd'
          : 'Ctrl'
        : part === 'alt' && platform === 'mac'
          ? 'Option'
        : part.length === 1
          ? part.toUpperCase()
          : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('+')
}
