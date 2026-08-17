import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

type ThemePreference = 'system' | 'light' | 'dark'

const storageKey = 'cadence.v1.theme'
const sequence: readonly ThemePreference[] = ['system', 'light', 'dark']

const labels: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

function readPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' || value === 'system'
      ? value
      : 'system'
  } catch {
    return 'system'
  }
}

function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement
  if (preference === 'system') {
    root.removeAttribute('data-theme')
    root.style.removeProperty('color-scheme')
  } else {
    root.dataset.theme = preference
    root.style.colorScheme = preference
  }

  try {
    window.localStorage.setItem(storageKey, preference)
  } catch {
    // The active theme still applies when storage is blocked.
  }
}

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const reduceMotion = useReducedMotion()
  const next = sequence[(sequence.indexOf(preference) + 1) % sequence.length]

  useEffect(() => {
    const saved = readPreference()
    setPreference(saved)
    applyPreference(saved)
  }, [])

  const cycleTheme = () => {
    setPreference(next)
    applyPreference(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      data-interaction="nav.theme"
      aria-label={`Theme preference: ${labels[preference]}. Activate to use ${labels[next]}.`}
      title={`Theme: ${labels[preference]}`}
      onClick={cycleTheme}
    >
      <span className="theme-toggle-prefix" aria-hidden="true">Theme</span>
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={preference}
          className="theme-toggle-value"
          initial={reduceMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          {labels[preference]}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
