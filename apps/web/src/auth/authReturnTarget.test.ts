import { describe, expect, it } from 'vitest'
import {
  consumeAuthCallback,
  mergeAuthReturnLocation,
  readAuthReturnTarget,
  safeAuthReturnTarget,
  saveAuthReturnTarget,
  takeAuthReturnTarget,
} from './authReturnTarget'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

describe('auth return targets', () => {
  it('stores only a same-origin pathname, search, and hash', () => {
    const storage = memoryStorage()
    const saved = saveAuthReturnTarget(
      'https://cadence.test/profile?collab=p1#project=x',
      storage,
      'https://cadence.test',
    )

    expect(saved).toBe('/profile?collab=p1#project=x')
    expect(takeAuthReturnTarget(storage, 'https://cadence.test')).toBe(
      '/profile?collab=p1#project=x',
    )
    expect(takeAuthReturnTarget(storage, 'https://cadence.test')).toBe('/')
  })

  it.each([
    'https://evil.test/profile',
    '//evil.test/profile',
    'javascript:alert(1)',
  ])('rejects an unsafe target: %s', (target) => {
    expect(safeAuthReturnTarget(target, 'https://cadence.test')).toBe('/')
  })

  it('consumes only auth callback parameters', () => {
    expect(
      consumeAuthCallback({
        pathname: '/',
        search: '?auth=success&collab=p1&role=editor&share=t&reason=ignored',
        hash: '#project=x',
      }),
    ).toEqual({
      outcome: 'success',
      reason: 'ignored',
      cleanLocation: {
        pathname: '/',
        search: '?collab=p1&role=editor&share=t',
        hash: '#project=x',
      },
    })
  })

  it('merges preserved callback inputs into the safe target', () => {
    expect(
      mergeAuthReturnLocation(
        '/profile?from=account',
        {
          pathname: '/',
          search: '?collab=p1&role=editor&share=t',
          hash: '#project=x',
        },
        'https://cadence.test',
      ),
    ).toEqual({
      pathname: '/profile',
      search: '?from=account&collab=p1&role=editor&share=t',
      hash: '#project=x',
    })
  })

  it('clears a corrupted stored target instead of retaining it', () => {
    const storage = memoryStorage()
    storage.setItem('cadence.v1.auth.return-target', 'https://evil.test/profile')

    expect(readAuthReturnTarget(storage, 'https://cadence.test')).toBeNull()
    expect(storage.getItem('cadence.v1.auth.return-target')).toBeNull()
  })
})
