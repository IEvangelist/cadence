import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginsController } from '../plugins/usePlugins'
import { useStudioCommandDispatcher } from './useStudioCommandDispatcher'

function plugins(runCommand = vi.fn()): PluginsController {
  return {
    commands: [
      {
        id: 'plugin.chord',
        title: 'Insert chord',
        keybinding: 'mod+alt+c',
        run: vi.fn(),
      },
    ],
    keybindingOverrides: {},
    runCommand,
  } as unknown as PluginsController
}

function actions(overrides = {}) {
  return {
    isPlaying: false,
    togglePlay: vi.fn(),
    canUndo: true,
    canRedo: true,
    undo: vi.fn(),
    redo: vi.fn(),
    openHelp: vi.fn(),
    ...overrides,
  }
}

describe('useStudioCommandDispatcher', () => {
  it('dispatches core and plugin commands from one window listener', () => {
    const core = actions()
    const extension = plugins()
    renderHook(() => useStudioCommandDispatcher(core, extension))

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })))
    expect(core.togglePlay).toHaveBeenCalledOnce()

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, altKey: true }),
      )
    })
    expect(extension.runCommand).toHaveBeenCalledWith('plugin.chord')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }),
      )
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))
    })
    expect(core.undo).toHaveBeenCalledOnce()
    expect(core.redo).toHaveBeenCalledOnce()
    expect(core.openHelp).toHaveBeenCalledOnce()
  })

  it('lets native text undo and dialog-owned keys win', () => {
    const core = actions()
    renderHook(() => useStudioCommandDispatcher(core, plugins()))
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      )
    })
    expect(core.undo).not.toHaveBeenCalled()

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(core.togglePlay).not.toHaveBeenCalled()
  })
})
