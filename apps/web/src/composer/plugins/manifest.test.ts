import { describe, expect, it } from 'vitest'
import { PluginManifestError, validateManifest } from './manifest'

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const manifest = validateManifest({ id: 'acme.demo', name: 'Demo', version: '1.0.0' })
    expect(manifest).toEqual({ id: 'acme.demo', name: 'Demo', version: '1.0.0' })
  })

  it('keeps optional fields when present and drops unknown ones', () => {
    const manifest = validateManifest({
      id: 'acme.demo',
      name: 'Demo',
      version: '2.3.4-beta.1',
      description: 'A demo',
      author: 'Acme',
      builtin: true,
      extraneous: 'ignored',
    })
    expect(manifest).toEqual({
      id: 'acme.demo',
      name: 'Demo',
      version: '2.3.4-beta.1',
      description: 'A demo',
      author: 'Acme',
      builtin: true,
    })
    expect(manifest).not.toHaveProperty('extraneous')
  })

  it('throws a typed error for a non-object', () => {
    expect(() => validateManifest(null)).toThrow(PluginManifestError)
    expect(() => validateManifest('nope')).toThrow(PluginManifestError)
    expect(() => validateManifest(42)).toThrow(/must be an object/)
  })

  it('rejects a missing or empty id', () => {
    expect(() => validateManifest({ name: 'X', version: '1.0.0' })).toThrow(PluginManifestError)
    expect(() => validateManifest({ id: '   ', name: 'X', version: '1.0.0' })).toThrow(/"id"/)
  })

  it('rejects a missing or empty name', () => {
    expect(() => validateManifest({ id: 'a', version: '1.0.0' })).toThrow(/"name"/)
    expect(() => validateManifest({ id: 'a', name: '', version: '1.0.0' })).toThrow(/"name"/)
  })

  it('rejects a malformed version', () => {
    expect(() => validateManifest({ id: 'a', name: 'A', version: 'v1' })).toThrow(/version/)
    expect(() => validateManifest({ id: 'a', name: 'A', version: '1.0' })).toThrow(/version/)
    expect(() => validateManifest({ id: 'a', name: 'A', version: 1 })).toThrow(/version/)
  })

  it('rejects wrong-typed optional fields', () => {
    expect(() =>
      validateManifest({ id: 'a', name: 'A', version: '1.0.0', description: 5 }),
    ).toThrow(/description/)
    expect(() =>
      validateManifest({ id: 'a', name: 'A', version: '1.0.0', author: {} }),
    ).toThrow(/author/)
  })

  it('names the plugin id in field errors for easy diagnosis', () => {
    expect(() => validateManifest({ id: 'acme.x', name: 'X', version: 'bad' })).toThrow(
      /Plugin "acme.x"/,
    )
  })

  // Security: a manifest id is used as a plain-object key for the enable/keybinding
  // gates, so an id that collides with an Object.prototype member (or carries odd
  // characters) must be rejected at the door — see isSafeId.
  it('rejects ids that collide with Object.prototype members', () => {
    for (const id of [
      '__proto__',
      'prototype',
      'constructor',
      'hasOwnProperty',
      'toString',
      'valueOf',
    ]) {
      expect(() => validateManifest({ id, name: 'X', version: '1.0.0' })).toThrow(
        PluginManifestError,
      )
    }
  })

  it('rejects ids with illegal characters or shape', () => {
    for (const id of ['Acme', 'a b', 'a/b', 'a:b', '.leading', '-leading', 'a'.repeat(65)]) {
      expect(() => validateManifest({ id, name: 'X', version: '1.0.0' })).toThrow(/"id"/)
    }
  })

  it('accepts safe lowercase, dotted, and dashed ids', () => {
    for (const id of ['a', 'acme.demo', 'acme.extra-instruments', 'a1._-x']) {
      expect(validateManifest({ id, name: 'X', version: '1.0.0' }).id).toBe(id)
    }
  })
})
