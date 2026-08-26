import { describe, expect, it } from 'vitest'
import { appAssetUrl, appRouteUrl } from './paths'

describe('appAssetUrl', () => {
  it('keeps runtime assets inside the deployment base', () => {
    expect(appAssetUrl('/favicon.svg', '/cadence/app/')).toBe(
      '/cadence/app/favicon.svg',
    )
    expect(appRouteUrl('/pricing', '/cadence/app/')).toBe(
      '/cadence/app/pricing',
    )
  })
})
