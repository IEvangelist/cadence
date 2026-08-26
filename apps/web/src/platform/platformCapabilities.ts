import type {
  KeyboardPlatform,
  PlatformCapabilities,
  PlatformCapabilitySource,
  PrimaryPointer,
  ViewportKind,
} from '../composer/contract/platform'

export const MOBILE_VIEWPORT_QUERY = '(max-width: 40rem)'
export const TABLET_VIEWPORT_QUERY = '(max-width: 60rem)'
export const COARSE_POINTER_QUERY = '(any-pointer: coarse)'
export const FINE_POINTER_QUERY = '(any-pointer: fine)'
export const PRIMARY_COARSE_POINTER_QUERY = '(pointer: coarse)'
export const PRIMARY_FINE_POINTER_QUERY = '(pointer: fine)'
export const STANDALONE_QUERY = '(display-mode: standalone)'

interface CapabilityMediaQueryList {
  readonly matches: boolean
  addEventListener?(type: 'change', listener: () => void): void
  removeEventListener?(type: 'change', listener: () => void): void
  addListener?(listener: () => void): void
  removeListener?(listener: () => void): void
}

export interface CapabilityWindow {
  readonly innerWidth?: number
  readonly innerHeight?: number
  readonly caches?: unknown
  matchMedia?(query: string): CapabilityMediaQueryList
  addEventListener?(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

export interface CapabilityNavigator {
  readonly platform?: string
  readonly maxTouchPoints?: number
  readonly onLine?: boolean
  readonly standalone?: boolean
  readonly serviceWorker?: unknown
}

export interface PlatformCapabilityEnvironment {
  window?: CapabilityWindow
  navigator?: CapabilityNavigator
}

const SERVER_CAPABILITIES: PlatformCapabilities = {
  keyboardPlatform: 'other',
  viewport: {
    kind: 'desktop',
    width: 0,
    height: 0,
    coarsePointer: false,
    finePointer: false,
  },
  coarsePointer: false,
  finePointer: false,
  primaryPointer: 'none',
  isStandalone: false,
  isOnline: true,
  hasCacheStorage: false,
  hasServiceWorker: false,
}

function queryMatches(
  win: CapabilityWindow | undefined,
  query: string,
  fallback = false,
): boolean {
  if (typeof win?.matchMedia !== 'function') return fallback
  return win.matchMedia(query).matches
}

function detectKeyboardPlatform(nav: CapabilityNavigator | undefined): KeyboardPlatform {
  const platform = nav?.platform ?? ''
  const iPadInDesktopMode =
    platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1
  return iPadInDesktopMode || /^(Mac|iPhone|iPad|iPod)/i.test(platform)
    ? 'mac'
    : 'other'
}

function hasCacheStorage(win: CapabilityWindow | undefined): boolean {
  try {
    return win !== undefined && 'caches' in win && win.caches != null
  } catch {
    return false
  }
}

function hasServiceWorker(nav: CapabilityNavigator | undefined): boolean {
  try {
    return nav !== undefined && 'serviceWorker' in nav && nav.serviceWorker != null
  } catch {
    return false
  }
}

function viewportKind(win: CapabilityWindow | undefined, width: number): ViewportKind {
  if (queryMatches(win, MOBILE_VIEWPORT_QUERY, width > 0 && width <= 640)) {
    return 'mobile'
  }
  if (queryMatches(win, TABLET_VIEWPORT_QUERY, width > 0 && width <= 960)) {
    return 'tablet'
  }
  return 'desktop'
}

export function readPlatformCapabilities(
  environment: PlatformCapabilityEnvironment,
): PlatformCapabilities {
  const win = environment.window
  const nav = environment.navigator
  const width = win?.innerWidth ?? 0
  const height = win?.innerHeight ?? 0
  const coarsePointer = queryMatches(win, COARSE_POINTER_QUERY)
  const finePointer = queryMatches(win, FINE_POINTER_QUERY)
  const primaryPointer: PrimaryPointer = queryMatches(
    win,
    PRIMARY_COARSE_POINTER_QUERY,
  )
    ? 'coarse'
    : queryMatches(win, PRIMARY_FINE_POINTER_QUERY)
      ? 'fine'
      : 'none'
  const displayModeStandalone = queryMatches(win, STANDALONE_QUERY)

  return {
    keyboardPlatform: detectKeyboardPlatform(nav),
    viewport: {
      kind: viewportKind(win, width),
      width,
      height,
      coarsePointer: primaryPointer === 'coarse',
      finePointer: primaryPointer === 'fine',
    },
    coarsePointer,
    finePointer,
    primaryPointer,
    isStandalone: displayModeStandalone || nav?.standalone === true,
    isOnline: nav?.onLine !== false,
    hasCacheStorage: hasCacheStorage(win),
    hasServiceWorker: hasServiceWorker(nav),
  }
}

function equalCapabilities(
  left: PlatformCapabilities,
  right: PlatformCapabilities,
): boolean {
  return (
    left.keyboardPlatform === right.keyboardPlatform &&
    left.viewport.kind === right.viewport.kind &&
    left.viewport.width === right.viewport.width &&
    left.viewport.height === right.viewport.height &&
    left.coarsePointer === right.coarsePointer &&
    left.finePointer === right.finePointer &&
    left.primaryPointer === right.primaryPointer &&
    left.isStandalone === right.isStandalone &&
    left.isOnline === right.isOnline &&
    left.hasCacheStorage === right.hasCacheStorage &&
    left.hasServiceWorker === right.hasServiceWorker
  )
}

const EVENT_TYPES = ['online', 'offline', 'resize'] as const
const MEDIA_QUERIES = [
  MOBILE_VIEWPORT_QUERY,
  TABLET_VIEWPORT_QUERY,
  COARSE_POINTER_QUERY,
  FINE_POINTER_QUERY,
  PRIMARY_COARSE_POINTER_QUERY,
  PRIMARY_FINE_POINTER_QUERY,
  STANDALONE_QUERY,
] as const

export function createPlatformCapabilitySource(
  environment: PlatformCapabilityEnvironment = {},
): PlatformCapabilitySource {
  const listeners = new Set<() => void>()
  let snapshot = readPlatformCapabilities(environment)
  let removeEnvironmentListeners: (() => void) | undefined

  const refresh = (notify: boolean): PlatformCapabilities => {
    const next = readPlatformCapabilities(environment)
    if (equalCapabilities(snapshot, next)) return snapshot
    snapshot = next
    if (notify) listeners.forEach((listener) => listener())
    return snapshot
  }

  const listen = () => {
    const win = environment.window
    if (!win) return () => undefined
    const onChange = () => refresh(true)
    EVENT_TYPES.forEach((type) => win.addEventListener?.(type, onChange))
    const media = MEDIA_QUERIES.map((query) => win.matchMedia?.(query)).filter(
      (value): value is CapabilityMediaQueryList => value !== undefined,
    )
    media.forEach((query) => {
      if (query.addEventListener) query.addEventListener('change', onChange)
      else query.addListener?.(onChange)
    })
    return () => {
      EVENT_TYPES.forEach((type) => win.removeEventListener?.(type, onChange))
      media.forEach((query) => {
        if (query.removeEventListener) query.removeEventListener('change', onChange)
        else query.removeListener?.(onChange)
      })
    }
  }

  return {
    getSnapshot: () => refresh(false),
    getServerSnapshot: () => SERVER_CAPABILITIES,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        removeEnvironmentListeners = listen()
        refresh(false)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          removeEnvironmentListeners?.()
          removeEnvironmentListeners = undefined
        }
      }
    },
  }
}

const browserEnvironment: PlatformCapabilityEnvironment = {
  window: typeof window === 'undefined' ? undefined : window,
  navigator: typeof navigator === 'undefined' ? undefined : navigator,
}

export const browserPlatformCapabilitySource =
  createPlatformCapabilitySource(browserEnvironment)

export function capabilitySourceFor(
  win: CapabilityWindow | undefined,
  nav: CapabilityNavigator | undefined,
): PlatformCapabilitySource {
  if (win === browserEnvironment.window && nav === browserEnvironment.navigator) {
    return browserPlatformCapabilitySource
  }
  return createPlatformCapabilitySource({ window: win, navigator: nav })
}
