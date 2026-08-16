import { describe, expect, it, vi } from 'vitest'
import {
  composeStudioCommands,
  dispatchStudioCommand,
  isStudioShortcutScopeSuppressed,
  type StudioCommandCandidate,
} from './studioCommands'

const core = (run = vi.fn()): StudioCommandCandidate[] => [
  {
    id: 'core.transport.toggle-play',
    title: 'Play/Pause',
    group: 'Transport',
    defaultBinding: 'space',
    enabled: true,
    source: 'core',
    run,
  },
  {
    id: 'core.edit.undo',
    title: 'Undo',
    group: 'Edit',
    defaultBinding: 'mod+z',
    enabled: true,
    source: 'core',
    run,
  },
]

const plugin = (
  id: string,
  binding: string,
  run = vi.fn(),
): StudioCommandCandidate => ({
  id,
  title: id,
  group: 'Extensions',
  defaultBinding: binding,
  enabled: true,
  source: 'plugin',
  run,
})

describe('composeStudioCommands', () => {
  it('keeps core bindings reserved from plugin defaults and overrides', () => {
    const registry = composeStudioCommands(
      core(),
      [plugin('plugin.play', 'space'), plugin('plugin.undo', 'mod+u')],
      { 'plugin.undo': 'mod+z' },
    )

    expect(registry.commands.find((command) => command.id === 'plugin.play')?.binding)
      .toBeUndefined()
    expect(registry.commands.find((command) => command.id === 'plugin.undo')?.binding)
      .toBeUndefined()
    expect(registry.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rejectedId: 'plugin.play', reason: 'reserved-core' }),
        expect.objectContaining({ rejectedId: 'plugin.undo', reason: 'reserved-core' }),
      ]),
    )
  })

  it('prefers a non-conflicting user override over a plugin default deterministically', () => {
    const registry = composeStudioCommands(
      core(),
      [plugin('plugin.alpha', 'mod+k'), plugin('plugin.beta', 'mod+j')],
      { 'plugin.beta': 'mod+k' },
    )

    expect(registry.commands.find((command) => command.id === 'plugin.beta')?.binding)
      .toBe('mod+k')
    expect(registry.commands.find((command) => command.id === 'plugin.alpha')?.binding)
      .toBeUndefined()
    expect(registry.conflicts[0]).toMatchObject({
      winnerId: 'plugin.beta',
      rejectedId: 'plugin.alpha',
      reason: 'duplicate',
    })
  })
})

describe('dispatchStudioCommand', () => {
  it('prevents browser behavior only when an enabled command matches', () => {
    const run = vi.fn()
    const registry = composeStudioCommands(core(run), [], {})
    const matched = {
      key: ' ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: document.body,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    expect(dispatchStudioCommand(registry, matched)).toBe(true)
    expect(matched.preventDefault).toHaveBeenCalledOnce()
    expect(matched.stopPropagation).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledOnce()

    const unmatched = { ...matched, key: 'x', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    expect(dispatchStudioCommand(registry, unmatched)).toBe(false)
    expect(unmatched.preventDefault).not.toHaveBeenCalled()
  })

  it('does not consume a matching binding when the command is disabled', () => {
    const disabled = [{ ...core()[0], enabled: false }]
    const registry = composeStudioCommands(disabled, [], {})
    const event = {
      key: ' ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: document.body,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    expect(dispatchStudioCommand(registry, event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('isStudioShortcutScopeSuppressed', () => {
  it.each(['input', 'textarea', 'select'])('suppresses native editing in %s', (tag) => {
    expect(isStudioShortcutScopeSuppressed(document.createElement(tag))).toBe(true)
  })

  it('suppresses contenteditable, dialog, and active recorder scopes', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(isStudioShortcutScopeSuppressed(editable)).toBe(true)

    for (const attribute of ['role="dialog"', 'data-shortcut-recorder="active"']) {
      const host = document.createElement('div')
      const [name, value] = attribute.replaceAll('"', '').split('=')
      host.setAttribute(name, value)
      const child = document.createElement('button')
      host.append(child)
      expect(isStudioShortcutScopeSuppressed(child)).toBe(true)
    }
  })
})

