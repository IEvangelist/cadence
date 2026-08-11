import { useCallback, useMemo, useState } from 'react'

/**
 * Persisted open/closed state for the composer's collapsible side-rail panels
 * (#98 compact composer UX). Kept deliberately in the Composer layer — NOT in
 * `useComposer`/`engine` — so the layout overhaul never touches the audio hot
 * files that the #97 real-audio regression guards.
 */
export interface PanelLayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PANEL_LAYOUT_KEY = 'cadence.v1.composer.panelLayout'

/**
 * Default disclosure state. Tracks + AI Assistant open (the primary controls and
 * the surfaces the onboarding tour anchors to); the taller AI Studio, Mixer, and
 * Extensions panels start collapsed so the rail is compact by default. Quick
 * Starts starts collapsed too — a discoverable-but-unobtrusive shelf of house-dub
 * templates that doesn't push the primary controls down.
 */
export const DEFAULT_PANEL_OPEN: Readonly<Record<string, boolean>> = {
  tracks: true,
  quickStarts: false,
  assistant: true,
  aiStudio: false,
  mixer: false,
  extensions: false,
}

export interface PanelLayoutState {
  open: Record<string, boolean>
  railCollapsed: boolean
}

class MemoryPanelLayoutStorage implements PanelLayoutStorage {
  private readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

export function createDefaultPanelLayoutStorage(): PanelLayoutStorage {
  try {
    const candidate =
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      typeof globalThis.localStorage !== 'undefined'
        ? globalThis.localStorage
        : null

    return candidate ?? new MemoryPanelLayoutStorage()
  } catch {
    return new MemoryPanelLayoutStorage()
  }
}

function readState(storage: PanelLayoutStorage): PanelLayoutState {
  const fallback: PanelLayoutState = { open: { ...DEFAULT_PANEL_OPEN }, railCollapsed: false }

  try {
    const raw = storage.getItem(PANEL_LAYOUT_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<PanelLayoutState> | null
    if (!parsed || typeof parsed !== 'object') return fallback

    const open = { ...DEFAULT_PANEL_OPEN }
    if (parsed.open && typeof parsed.open === 'object') {
      for (const [id, value] of Object.entries(parsed.open)) {
        if (typeof value === 'boolean') open[id] = value
      }
    }

    return { open, railCollapsed: parsed.railCollapsed === true }
  } catch {
    return fallback
  }
}

function persist(storage: PanelLayoutStorage, state: PanelLayoutState): void {
  try {
    storage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable or denied (private mode, quota); layout state is
    // a convenience and must never block editing.
  }
}

export interface UsePanelLayoutOptions {
  storage?: PanelLayoutStorage
}

export interface PanelLayout {
  /** Whether a panel's disclosure is expanded. Unknown ids default to closed. */
  isOpen(id: string): boolean
  /** Flip a panel between expanded and collapsed, persisting the choice. */
  toggle(id: string): void
  /** Whether the whole side rail is collapsed out of the layout. */
  railCollapsed: boolean
  /** Show/hide the entire side rail, persisting the choice. */
  toggleRail(): void
}

export function usePanelLayout({ storage }: UsePanelLayoutOptions = {}): PanelLayout {
  const [backend] = useState(() => storage ?? createDefaultPanelLayoutStorage())
  const [state, setState] = useState<PanelLayoutState>(() => readState(backend))

  const isOpen = useCallback(
    (id: string): boolean => state.open[id] ?? false,
    [state.open],
  )

  const toggle = useCallback(
    (id: string): void => {
      setState((prev) => {
        const next: PanelLayoutState = {
          ...prev,
          open: { ...prev.open, [id]: !(prev.open[id] ?? false) },
        }
        persist(backend, next)
        return next
      })
    },
    [backend],
  )

  const toggleRail = useCallback((): void => {
    setState((prev) => {
      const next: PanelLayoutState = { ...prev, railCollapsed: !prev.railCollapsed }
      persist(backend, next)
      return next
    })
  }, [backend])

  return useMemo(
    () => ({ isOpen, toggle, railCollapsed: state.railCollapsed, toggleRail }),
    [isOpen, toggle, state.railCollapsed, toggleRail],
  )
}
