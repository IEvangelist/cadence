import { describe, expect, it } from 'vitest'
import { hashString, mulberry32, pick, randInt } from './rng'

describe('rng', () => {
  it('hashString is deterministic and returns an unsigned 32-bit int', () => {
    const a = hashString('dark moody piano')
    const b = hashString('dark moody piano')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(a)).toBe(true)
  })

  it('hashString differs for different inputs', () => {
    expect(hashString('one')).not.toBe(hashString('two'))
  })

  it('hashString handles the empty string deterministically', () => {
    expect(hashString('')).toBe(hashString(''))
  })

  it('mulberry32 is reproducible for a given seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('mulberry32 yields values in [0, 1) and varies across seeds', () => {
    const next = mulberry32(999)
    for (let i = 0; i < 50; i += 1) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('randInt stays within the inclusive range', () => {
    const next = mulberry32(42)
    for (let i = 0; i < 100; i += 1) {
      const value = randInt(next, 3, 7)
      expect(value).toBeGreaterThanOrEqual(3)
      expect(value).toBeLessThanOrEqual(7)
      expect(Number.isInteger(value)).toBe(true)
    }
  })

  it('randInt returns min when max <= min', () => {
    const next = mulberry32(1)
    expect(randInt(next, 5, 5)).toBe(5)
    expect(randInt(next, 9, 2)).toBe(9)
  })

  it('pick selects a member of the array', () => {
    const next = mulberry32(7)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 20; i += 1) {
      expect(items).toContain(pick(next, items))
    }
  })
})
