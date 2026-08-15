import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyThemePreference,
  persistThemePreference,
  readThemePreference,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from './themeStorage'

describe('theme storage', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('color-scheme')
  })

  it('persists and restores every supported preference', () => {
    for (const preference of ['system', 'light', 'dark'] as const) {
      persistThemePreference(preference, localStorage)
      expect(readThemePreference(localStorage)).toBe(preference)
    }
  })

  it('removes explicit theme state for system mode', () => {
    applyThemePreference('dark')
    applyThemePreference('system')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(document.documentElement.style.colorScheme).toBe('')
  })

  it('falls back safely when storage is denied', () => {
    const denied: ThemeStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    expect(readThemePreference(denied)).toBe('system')
    expect(() => persistThemePreference('dark', denied)).not.toThrow()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeDefined()
  })
})
