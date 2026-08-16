import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_OPEN,
  PANEL_LAYOUT_KEY,
  type PanelLayoutStorage,
  usePanelLayout,
} from './usePanelLayout'

class FakeStorage implements PanelLayoutStorage {
  readonly map = new Map<string, string>()

  constructor(seed?: string) {
    if (seed !== undefined) this.map.set(PANEL_LAYOUT_KEY, seed)
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

describe('usePanelLayout', () => {
  it('starts from the compact defaults (Tracks + AI Assistant open)', () => {
    const { result } = renderHook(() => usePanelLayout({ storage: new FakeStorage() }))

    expect(result.current.isOpen('tracks')).toBe(true)
    expect(result.current.isOpen('assistant')).toBe(true)
    expect(result.current.isOpen('mixer')).toBe(false)
    expect(result.current.isOpen('aiStudio')).toBe(false)
    expect(result.current.isOpen('extensions')).toBe(false)
    expect(DEFAULT_PANEL_OPEN).not.toHaveProperty('quickStarts')
    expect(result.current.isOpen('quickStarts')).toBe(false)
    expect(result.current.railCollapsed).toBe(false)
    // Unknown panels default to closed rather than throwing.
    expect(result.current.isOpen('nope')).toBe(false)
  })

  it('toggles a panel and persists the choice', () => {
    const storage = new FakeStorage()
    const { result } = renderHook(() => usePanelLayout({ storage }))

    act(() => result.current.toggle('mixer'))
    expect(result.current.isOpen('mixer')).toBe(true)

    const persisted = JSON.parse(storage.getItem(PANEL_LAYOUT_KEY) as string)
    expect(persisted.open.mixer).toBe(true)
  })

  it('rehydrates persisted state on mount', () => {
    const storage = new FakeStorage(
      JSON.stringify({ open: { tracks: false, mixer: true }, railCollapsed: true }),
    )
    const { result } = renderHook(() => usePanelLayout({ storage }))

    // Persisted values win; unspecified panels fall back to their defaults.
    expect(result.current.isOpen('tracks')).toBe(false)
    expect(result.current.isOpen('mixer')).toBe(true)
    expect(result.current.isOpen('assistant')).toBe(DEFAULT_PANEL_OPEN.assistant)
    expect(result.current.railCollapsed).toBe(true)
  })

  it('toggles the whole rail', () => {
    const { result } = renderHook(() => usePanelLayout({ storage: new FakeStorage() }))

    act(() => result.current.toggleRail())
    expect(result.current.railCollapsed).toBe(true)
  })

  it('falls back to defaults when the stored value is malformed', () => {
    const { result } = renderHook(() =>
      usePanelLayout({ storage: new FakeStorage('} not json {') }),
    )

    expect(result.current.isOpen('tracks')).toBe(true)
    expect(result.current.railCollapsed).toBe(false)
  })
})
