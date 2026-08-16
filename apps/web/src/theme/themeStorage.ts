export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'cadence.v1.theme'

export interface ThemeStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readThemePreference(storage?: ThemeStorage): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY)
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyThemePreference(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
): void {
  if (preference === 'system') {
    root.removeAttribute('data-theme')
    root.style.removeProperty('color-scheme')
    return
  }
  root.dataset.theme = preference
  root.style.colorScheme = preference
}

export function persistThemePreference(
  preference: ThemePreference,
  storage?: ThemeStorage,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Theme selection remains usable when storage is unavailable.
  }
}

export function browserThemeStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
