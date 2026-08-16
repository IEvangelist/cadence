import { type ReactNode, useMemo, useState } from 'react'
import {
  applyThemePreference,
  browserThemeStorage,
  persistThemePreference,
  readThemePreference,
  type ThemePreference,
  type ThemeStorage,
} from './themeStorage'
import { ThemeContext, type ThemeContextValue } from './themeContext'

interface ThemeProviderProps {
  children: ReactNode
  storage?: ThemeStorage
}

export function ThemeProvider({ children, storage = browserThemeStorage() }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    const initial = readThemePreference(storage)
    applyThemePreference(initial)
    return initial
  })

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      setPreference(next) {
        applyThemePreference(next)
        persistThemePreference(next, storage)
        setPreferenceState(next)
      },
    }),
    [preference, storage],
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}
