import { describe, expect, it, vi } from 'vitest'
import {
  COARSE_POINTER_QUERY,
  createPlatformCapabilitySource,
  FINE_POINTER_QUERY,
  MOBILE_VIEWPORT_QUERY,
  readPlatformCapabilities,
  STANDALONE_QUERY,
  TABLET_VIEWPORT_QUERY,
  type CapabilityNavigator,
  type CapabilityWindow,
} from './platformCapabilities'

class FakeMediaQuery {
  matches = false
  private readonly listeners = new Set<() => void>()

  addEventListener(_type: 'change', listener: () => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'change', listener: () => void) {
    this.listeners.delete(listener)
  }

  setMatches(matches: boolean) {
    this.matches = matches
    this.listeners.forEach((listener) => listener())
  }
}

function environment({
  width = 1440,
  height = 900,
  platform = 'Win32',
  maxTouchPoints = 0,
  online = true,
  cacheStorage = true,
  serviceWorker = true,
}: {
  width?: number
  height?: number
  platform?: string
  maxTouchPoints?: number
  online?: boolean
  cacheStorage?: boolean
  serviceWorker?: boolean
} = {}) {
  const media = new Map<string, FakeMediaQuery>()
  const events = new Map<string, Set<() => void>>()
  const win: CapabilityWindow & { innerWidth: number; innerHeight: number } = {
    innerWidth: width,
    innerHeight: height,
    matchMedia(query) {
      let result = media.get(query)
      if (!result) {
        result = new FakeMediaQuery()
        media.set(query, result)
      }
      return result
    },
    addEventListener(type, listener) {
      const registered = events.get(type) ?? new Set()
      registered.add(listener)
      events.set(type, registered)
    },
    removeEventListener(type, listener) {
      events.get(type)?.delete(listener)
    },
  }
  if (cacheStorage) Object.assign(win, { caches: {} })

  const nav: CapabilityNavigator & {
    onLine: boolean
    platform: string
    maxTouchPoints: number
  } = {
    platform,
    maxTouchPoints,
    onLine: online,
  }
  if (serviceWorker) Object.assign(nav, { serviceWorker: {} })

  return {
    win,
    nav,
    media(query: string) {
      return win.matchMedia!(query) as FakeMediaQuery
    },
    dispatch(type: string) {
      events.get(type)?.forEach((listener) => listener())
    },
  }
}

describe('platform capability detection', () => {
  it('uses Mac key labels for Macs and touch iPads in desktop mode', () => {
    const mac = environment({ platform: 'MacIntel' })
    expect(readPlatformCapabilities({ window: mac.win, navigator: mac.nav }).keyboardPlatform)
      .toBe('mac')

    const ipad = environment({ platform: 'MacIntel', maxTouchPoints: 5 })
    expect(readPlatformCapabilities({ window: ipad.win, navigator: ipad.nav }).keyboardPlatform)
      .toBe('mac')

    const windows = environment({ platform: 'Win32', maxTouchPoints: 10 })
    expect(
      readPlatformCapabilities({ window: windows.win, navigator: windows.nav })
        .keyboardPlatform,
    ).toBe('other')
  })

  it('classifies viewport and independently reports coarse and fine pointers', () => {
    const runtime = environment({ width: 768, height: 1024 })
    runtime.media(TABLET_VIEWPORT_QUERY).setMatches(true)
    runtime.media(COARSE_POINTER_QUERY).setMatches(true)
    runtime.media(FINE_POINTER_QUERY).setMatches(true)

    const capabilities = readPlatformCapabilities({
      window: runtime.win,
      navigator: runtime.nav,
    })

    expect(capabilities.viewport).toEqual({
      kind: 'tablet',
      width: 768,
      height: 1024,
      coarsePointer: true,
      finePointer: true,
    })
    expect(capabilities.coarsePointer).toBe(true)
    expect(capabilities.finePointer).toBe(true)
  })

  it('recognizes browser, display-mode, and iOS standalone modes', () => {
    const browser = environment()
    expect(
      readPlatformCapabilities({ window: browser.win, navigator: browser.nav })
        .isStandalone,
    ).toBe(false)

    browser.media(STANDALONE_QUERY).setMatches(true)
    expect(
      readPlatformCapabilities({ window: browser.win, navigator: browser.nav })
        .isStandalone,
    ).toBe(true)

    const ios = environment()
    Object.assign(ios.nav, { standalone: true })
    expect(
      readPlatformCapabilities({ window: ios.win, navigator: ios.nav })
        .isStandalone,
    ).toBe(true)
  })

  it('falls back safely when browser APIs are missing', () => {
    const capabilities = readPlatformCapabilities({
      window: { innerWidth: 700, innerHeight: 800 },
      navigator: { platform: '' },
    })

    expect(capabilities).toMatchObject({
      keyboardPlatform: 'other',
      viewport: { kind: 'tablet', width: 700, height: 800 },
      coarsePointer: false,
      finePointer: false,
      isStandalone: false,
      isOnline: true,
      hasCacheStorage: false,
      hasServiceWorker: false,
    })
  })

  it('provides a deterministic server snapshot without browser globals', () => {
    const source = createPlatformCapabilitySource()
    expect(source.getSnapshot()).toEqual(source.getServerSnapshot())
    expect(source.getServerSnapshot()).toMatchObject({
      keyboardPlatform: 'other',
      viewport: { kind: 'desktop', width: 0, height: 0 },
      isOnline: true,
      hasCacheStorage: false,
      hasServiceWorker: false,
    })
  })
})

describe('platform capability source transitions', () => {
  it('publishes online and offline transitions with stable snapshots', () => {
    const runtime = environment()
    const source = createPlatformCapabilitySource({
      window: runtime.win,
      navigator: runtime.nav,
    })
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    const initial = source.getSnapshot()

    expect(source.getSnapshot()).toBe(initial)
    runtime.nav.onLine = false
    runtime.dispatch('offline')
    expect(source.getSnapshot().isOnline).toBe(false)
    runtime.nav.onLine = true
    runtime.dispatch('online')
    expect(source.getSnapshot().isOnline).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    runtime.nav.onLine = false
    runtime.dispatch('offline')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('publishes viewport, pointer, and standalone media changes', () => {
    const runtime = environment({ width: 390, height: 844 })
    const source = createPlatformCapabilitySource({
      window: runtime.win,
      navigator: runtime.nav,
    })
    const listener = vi.fn()
    source.subscribe(listener)

    runtime.media(MOBILE_VIEWPORT_QUERY).setMatches(true)
    runtime.media(COARSE_POINTER_QUERY).setMatches(true)
    runtime.media(STANDALONE_QUERY).setMatches(true)

    expect(source.getSnapshot()).toMatchObject({
      viewport: { kind: 'mobile' },
      coarsePointer: true,
      isStandalone: true,
    })
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
