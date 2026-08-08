import { describe, expect, it } from 'vitest'
import { appName, tagline } from './appInfo'

describe('appInfo', () => {
  it('exposes the product name', () => {
    expect(appName).toBe('Cadence')
  })

  it('exposes a non-empty tagline', () => {
    expect(tagline.length).toBeGreaterThan(0)
  })
})
