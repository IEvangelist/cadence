import { describe, expect, it } from 'vitest'
import { cadenceCacheName } from './cacheName'

describe('cadenceCacheName', () => {
  it('isolates caches by app base', () => {
    expect(cadenceCacheName('/cadence/app/')).toBe(
      'cadence-shell:/cadence/app/:v2',
    )
    expect(cadenceCacheName('/')).toBe('cadence-shell:/:v2')
  })
})
