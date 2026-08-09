import { describe, expect, it } from 'vitest'
import {
  buildCollabConfig,
  colorForId,
  parseCollabParams,
  resolveRelayUrl,
} from './collabConfig'

describe('parseCollabParams', () => {
  it('returns null without a collab param (single-user)', () => {
    expect(parseCollabParams('')).toBeNull()
    expect(parseCollabParams('?foo=bar')).toBeNull()
  })

  it('parses projectId, role, and token', () => {
    expect(parseCollabParams('?collab=p1&role=editor&share=tok')).toEqual({
      projectId: 'p1',
      role: 'editor',
      token: 'tok',
    })
  })

  it('fails closed to viewer for an unknown or missing role', () => {
    expect(parseCollabParams('?collab=p1')?.role).toBe('viewer')
    expect(parseCollabParams('?collab=p1&role=admin')?.role).toBe('viewer')
  })
})

describe('resolveRelayUrl', () => {
  it('derives ws/wss from the page protocol', () => {
    expect(resolveRelayUrl({ protocol: 'http:', host: 'localhost:4173' })).toBe(
      'ws://localhost:4173/api/collab',
    )
    expect(resolveRelayUrl({ protocol: 'https:', host: 'app.test' })).toBe(
      'wss://app.test/api/collab',
    )
  })

  it('honors an explicit override', () => {
    expect(
      resolveRelayUrl({ protocol: 'http:', host: 'x' }, 'ws://relay:9000/api/collab'),
    ).toBe('ws://relay:9000/api/collab')
  })
})

describe('colorForId', () => {
  it('is deterministic for the same id', () => {
    expect(colorForId('abc')).toBe(colorForId('abc'))
  })
  it('differs across ids', () => {
    expect(colorForId('abc')).not.toBe(colorForId('xyz'))
  })
})

describe('buildCollabConfig', () => {
  const location = { protocol: 'https:', host: 'app.test' }

  it('returns null when anonymous', () => {
    expect(
      buildCollabConfig({ search: '?collab=p1', location, user: null }),
    ).toBeNull()
  })

  it('returns null when there is no collab param', () => {
    expect(
      buildCollabConfig({ search: '', location, user: { id: 'u', displayName: 'Ada' } }),
    ).toBeNull()
  })

  it('builds a config tied to the signed-in identity', () => {
    const config = buildCollabConfig({
      search: '?collab=p1&role=owner&share=tok',
      location,
      user: { id: 'u1', displayName: 'Ada' },
    })
    expect(config).toMatchObject({
      projectId: 'p1',
      role: 'owner',
      token: 'tok',
      url: 'wss://app.test/api/collab',
      user: { id: 'u1', name: 'Ada' },
    })
    expect(config?.user.color).toBe(colorForId('u1'))
  })
})
