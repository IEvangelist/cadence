import { beforeEach, describe, expect, it } from 'vitest'
import { prefetchSecondaryRoutes } from './routePrefetch'

describe('prefetchSecondaryRoutes', () => {
  beforeEach(() => {
    window.__CADENCE_ROUTE_PREFETCH_READY__ = false
  })

  it('warms every secondary lazy module and publishes readiness', async () => {
    await prefetchSecondaryRoutes(window, navigator)
    expect(window.__CADENCE_ROUTE_PREFETCH_READY__).toBe(true)
  })
})
