import { describe, expect, it } from 'vitest'
import { coversInteractions } from './coversInteractions'

describe('coversInteractions', () => {
  it('rejects unknown IDs', () => {
    const unknownId = 'not.a.real.interaction'
    expect(() => coversInteractions(unknownId)).toThrow(
      'Unknown interaction ID: not.a.real.interaction',
    )
  })
})
