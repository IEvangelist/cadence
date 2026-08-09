import { describe, expect, it } from 'vitest'
import {
  canonicalizeKeybinding,
  eventToKeybinding,
  formatKeybinding,
  resolveKeybindingMap,
} from './keybindings'
import type { CommandContribution } from './types'

const noop = () => {}

describe('canonicalizeKeybinding', () => {
  it('normalizes case and modifier order', () => {
    expect(canonicalizeKeybinding('Shift+MOD+H')).toBe('mod+shift+h')
    expect(canonicalizeKeybinding('mod+shift+h')).toBe('mod+shift+h')
    expect(canonicalizeKeybinding('alt+mod+k')).toBe('mod+alt+k')
  })
})

describe('eventToKeybinding', () => {
  it('maps ctrl/meta to mod and orders modifiers', () => {
    expect(
      eventToKeybinding({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, key: 'H' }),
    ).toBe('mod+shift+h')
    expect(
      eventToKeybinding({ ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, key: 'k' }),
    ).toBe('mod+k')
  })

  it('returns null when only a modifier key is pressed', () => {
    expect(
      eventToKeybinding({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'Control' }),
    ).toBeNull()
  })

  it('names the space key', () => {
    expect(
      eventToKeybinding({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: ' ' }),
    ).toBe('space')
  })
})

describe('resolveKeybindingMap', () => {
  const commands: CommandContribution[] = [
    { id: 'a', title: 'A', keybinding: 'mod+shift+a', run: noop },
    { id: 'b', title: 'B', run: noop },
    { id: 'c', title: 'C', keybinding: 'mod+shift+c', run: noop },
  ]

  it('maps default bindings to command ids and skips unbound commands', () => {
    const map = resolveKeybindingMap(commands, {})
    expect(map.get('mod+shift+a')).toBe('a')
    expect(map.get('mod+shift+c')).toBe('c')
    expect([...map.values()]).not.toContain('b')
  })

  it('applies user overrides over the default binding', () => {
    const map = resolveKeybindingMap(commands, { a: 'mod+alt+z' })
    expect(map.get('mod+alt+z')).toBe('a')
    expect(map.has('mod+shift+a')).toBe(false)
  })
})

describe('formatKeybinding', () => {
  it('renders a human-readable shortcut', () => {
    expect(formatKeybinding('mod+shift+h')).toBe('Ctrl+Shift+H')
    expect(formatKeybinding('mod+k')).toBe('Ctrl+K')
    expect(formatKeybinding('alt+mod+space')).toBe('Ctrl+Alt+Space')
  })
})
