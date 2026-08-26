import { describe, expect, it, vi } from 'vitest'
import { restorePagesRoute } from './pagesFallback'

describe('restorePagesRoute', () => {
  it('restores a Pages fallback route with collaboration query and share hash', () => {
    const replaceState = vi.fn()
    const route =
      '/stems?collab=room-1&role=viewer&share=token#project=encoded'
    const restored = restorePagesRoute(
      {
        pathname: '/cadence/app/',
        search: `?__cadence_route=${encodeURIComponent(route)}`,
      },
      { replaceState },
      '/cadence/app/',
    )

    expect(restored).toBe(true)
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      `/cadence/app${route}`,
    )
  })

  it('ignores missing and protocol-relative fallback values', () => {
    const replaceState = vi.fn()
    expect(
      restorePagesRoute(
        { pathname: '/cadence/app/', search: '?__cadence_route=%2F%2Fevil.test' },
        { replaceState },
        '/cadence/app/',
      ),
    ).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })
})
