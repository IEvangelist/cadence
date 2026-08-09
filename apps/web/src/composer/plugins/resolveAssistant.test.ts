import { describe, expect, it, vi } from 'vitest'
import { PluginHost } from './host'
import { resolveAssistant } from './resolveAssistant'
import { BUILTIN_AI_PROVIDERS } from './builtins/aiProviders'
import type { AiProviderContribution } from './types'
import type { CompositionAssistant } from '../ai/types'

function fakeProvider(id: string): CompositionAssistant {
  return {
    id,
    capabilities: new Set(['generate']),
    generate: vi.fn(async () => ({ label: 'x', notes: [] })),
  } as unknown as CompositionAssistant
}

function providerContribution(id: string): AiProviderContribution {
  return { id, name: id, create: () => fakeProvider(id) }
}

function hostWith(...ids: string[]): PluginHost {
  const host = new PluginHost()
  host.use({
    manifest: { id: 'test.ai', name: 'AI', version: '1.0.0' },
    contributes: { aiProviders: ids.map(providerContribution) },
  })
  return host
}

describe('built-in AI provider contributions', () => {
  it('registers magenta and mock with matching provider ids', () => {
    expect(BUILTIN_AI_PROVIDERS.map((p) => p.id)).toEqual(['magenta', 'mock'])
    for (const provider of BUILTIN_AI_PROVIDERS) {
      const instance = provider.create()
      expect(instance.id).toBe(provider.id)
    }
  })
})

describe('resolveAssistant', () => {
  it('uses the mock provider when useMock is set', () => {
    const host = hostWith('magenta', 'mock')
    expect(resolveAssistant({ host, useMock: true }).id).toBe('mock')
  })

  it('honors an explicit preferred provider id', () => {
    const host = hostWith('magenta', 'mock', 'acme')
    expect(resolveAssistant({ host, preferredId: 'acme' }).id).toBe('acme')
  })

  it('falls back to the first non-mock provider by default', () => {
    const host = hostWith('magenta', 'mock')
    expect(resolveAssistant({ host }).id).toBe('magenta')
  })

  it('invokes the resolved provider through the assistant interface', async () => {
    const host = hostWith('acme', 'mock')
    const provider = resolveAssistant({ host, preferredId: 'acme' })
    await provider.generate(
      { action: 'generate', seedNotes: [], regionStart: 0, tempo: 120, params: { temperature: 1, lengthBeats: 4 } },
      () => {},
    )
    expect(provider.generate).toHaveBeenCalledOnce()
  })

  it('falls back to a mock provider when the host is empty', () => {
    expect(resolveAssistant({ host: new PluginHost() }).id).toBe('mock')
  })
})
