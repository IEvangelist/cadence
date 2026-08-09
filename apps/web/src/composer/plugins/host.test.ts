import { describe, expect, it, vi } from 'vitest'
import { PluginHost, PluginRegistrationError, createPluginHost } from './host'
import { PluginManifestError } from './manifest'
import type { CadencePlugin, InstrumentContribution } from './types'

const noopVoice = () => ({ trigger: () => {}, dispose: () => {} })

function instrument(id: string): InstrumentContribution {
  return { id, name: id, kind: 'synth', description: id, polyphonic: true, createVoice: noopVoice }
}

function plugin(id: string, over: Partial<CadencePlugin> = {}): CadencePlugin {
  return {
    manifest: { id, name: id, version: '1.0.0' },
    contributes: { instruments: [instrument(`${id}.inst`)] },
    ...over,
  }
}

describe('PluginHost registration', () => {
  it('validates the manifest on register', () => {
    const host = createPluginHost()
    expect(() =>
      host.register({ manifest: { id: '', name: 'x', version: '1.0.0' } }),
    ).toThrow(PluginManifestError)
  })

  it('throws on a duplicate id without override', () => {
    const host = new PluginHost()
    host.register(plugin('a'))
    expect(() => host.register(plugin('a'))).toThrow(PluginRegistrationError)
  })

  it('replaces a plugin when override is set, disposing the old one', () => {
    const host = new PluginHost()
    const dispose = vi.fn()
    host.use(plugin('a', { dispose }))
    const next = plugin('a', { contributes: { instruments: [instrument('a.v2')] } })
    host.register(next, { override: true })
    host.activate('a')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(host.instruments().map((i) => i.id)).toEqual(['a.v2'])
  })
})

describe('PluginHost lifecycle', () => {
  it('exposes contributions only while active', () => {
    const host = new PluginHost()
    host.register(plugin('a'))
    // Registered but not active → no contributions yet.
    expect(host.instruments()).toEqual([])
    host.activate('a')
    expect(host.instruments().map((i) => i.id)).toEqual(['a.inst'])
  })

  it('runs the activate hook once', () => {
    const host = new PluginHost()
    const activate = vi.fn()
    host.use(plugin('a', { activate }))
    host.activate('a') // already active → no-op
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('disposes: hides contributions and calls the dispose hook, then re-activates', () => {
    const host = new PluginHost()
    const dispose = vi.fn()
    host.use(plugin('a', { dispose }))
    expect(host.isActive('a')).toBe(true)

    host.dispose('a')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(host.isActive('a')).toBe(false)
    expect(host.instruments()).toEqual([])

    // Re-activation restores the contributions (enable/disable toggling).
    host.activate('a')
    expect(host.instruments().map((i) => i.id)).toEqual(['a.inst'])
  })

  it('dispose is idempotent and a no-op for unknown ids', () => {
    const host = new PluginHost()
    const dispose = vi.fn()
    host.use(plugin('a', { dispose }))
    host.dispose('a')
    host.dispose('a')
    host.dispose('missing')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('unregister removes the plugin entirely', () => {
    const host = new PluginHost()
    host.use(plugin('a'))
    host.unregister('a')
    expect(host.has('a')).toBe(false)
    expect(host.instruments()).toEqual([])
  })

  it('activating an unknown plugin throws', () => {
    const host = new PluginHost()
    expect(() => host.activate('nope')).toThrow(PluginRegistrationError)
  })
})

describe('PluginHost contribution aggregation', () => {
  it('collects contributions from all active plugins in order', () => {
    const host = new PluginHost()
    host.use(plugin('a'))
    host.use(plugin('b'))
    expect(host.instruments().map((i) => i.id)).toEqual(['a.inst', 'b.inst'])
  })

  it('lets a later plugin override a contribution id (last wins)', () => {
    const host = new PluginHost()
    host.use({
      manifest: { id: 'core', name: 'Core', version: '1.0.0' },
      contributes: { instruments: [instrument('poly-synth')] },
    })
    host.use({
      manifest: { id: 'custom', name: 'Custom', version: '1.0.0' },
      contributes: {
        instruments: [{ ...instrument('poly-synth'), name: 'Custom Poly' }],
      },
    })
    const poly = host.instruments().filter((i) => i.id === 'poly-synth')
    expect(poly).toHaveLength(1)
    expect(poly[0].name).toBe('Custom Poly')
  })

  it('reports registered plugins via list()', () => {
    const host = new PluginHost()
    host.register(plugin('a'))
    host.use(plugin('b'))
    expect(host.list().map((p) => [p.manifest.id, p.state])).toEqual([
      ['a', 'registered'],
      ['b', 'active'],
    ])
  })
})

describe('PluginHost subscribe', () => {
  it('notifies subscribers on lifecycle changes and supports unsubscribe', () => {
    const host = new PluginHost()
    const listener = vi.fn()
    const off = host.subscribe(listener)
    host.register(plugin('a')) // 1
    host.activate('a') // 2
    host.dispose('a') // 3
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    host.use(plugin('b'))
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
