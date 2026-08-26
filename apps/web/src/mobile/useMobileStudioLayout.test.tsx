import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  PlatformCapabilities,
  PlatformCapabilitySource,
} from '../composer/contract/platform'
import { PlatformCapabilitiesProvider } from '../platform/PlatformCapabilitiesProvider'
import { useMobileStudioLayout } from './useMobileStudioLayout'

function source(
  overrides: Partial<PlatformCapabilities>,
): PlatformCapabilitySource {
  const snapshot: PlatformCapabilities = {
    keyboardPlatform: 'other',
    viewport: {
      kind: 'desktop',
      width: 1440,
      height: 900,
      coarsePointer: false,
      finePointer: true,
    },
    coarsePointer: false,
    finePointer: true,
    isStandalone: false,
    isOnline: true,
    hasCacheStorage: true,
    hasServiceWorker: true,
    ...overrides,
  }
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  }
}

function mobileLayout(capabilities: PlatformCapabilitySource) {
  return renderHook(() => useMobileStudioLayout(), {
    wrapper: ({ children }) => (
      <PlatformCapabilitiesProvider source={capabilities}>
        {children}
      </PlatformCapabilitiesProvider>
    ),
  }).result
}

describe('useMobileStudioLayout', () => {
  it('uses mobile layout for the existing narrow-viewport seam', () => {
    const result = mobileLayout(
      source({
        viewport: {
          kind: 'mobile',
          width: 390,
          height: 844,
          coarsePointer: false,
          finePointer: true,
        },
      }),
    )
    expect(result.current).toBe(true)
  })

  it('uses mobile layout for coarse pointers without treating every tablet as mobile', () => {
    const coarse = mobileLayout(
      source({
        viewport: {
          kind: 'tablet',
          width: 768,
          height: 1024,
          coarsePointer: true,
          finePointer: false,
        },
        coarsePointer: true,
        finePointer: false,
      }),
    )
    const fine = mobileLayout(
      source({
        viewport: {
          kind: 'tablet',
          width: 768,
          height: 1024,
          coarsePointer: false,
          finePointer: true,
        },
      }),
    )

    expect(coarse.current).toBe(true)
    expect(fine.current).toBe(false)
  })
})
