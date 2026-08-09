import { describe, expect, it, vi } from 'vitest'
import { connectEffectChain, type ChainableEffect } from './effectChain'

/** A fake connectable node that records what it connects to. */
function fakeNode(label: string) {
  const connect = vi.fn()
  return { label, connect }
}

function fakeEffect(label: string): ChainableEffect & { input: ReturnType<typeof fakeNode> } {
  return { input: fakeNode(`${label}.in`), output: fakeNode(`${label}.out`) }
}

describe('connectEffectChain', () => {
  it('connects source straight to destination when there are no effects', () => {
    const source = fakeNode('src')
    const destination = fakeNode('dest')

    connectEffectChain(source, [], destination)

    expect(source.connect).toHaveBeenCalledTimes(1)
    expect(source.connect).toHaveBeenCalledWith(destination)
  })

  it('routes source → effect → destination for a single effect', () => {
    const source = fakeNode('src')
    const destination = fakeNode('dest')
    const effect = fakeEffect('fx')

    connectEffectChain(source, [effect], destination)

    expect(source.connect).toHaveBeenCalledWith(effect.input)
    expect(effect.output.connect).toHaveBeenCalledWith(destination)
  })

  it('chains multiple effects in order', () => {
    const source = fakeNode('src')
    const destination = fakeNode('dest')
    const a = fakeEffect('a')
    const b = fakeEffect('b')

    connectEffectChain(source, [a, b], destination)

    expect(source.connect).toHaveBeenCalledWith(a.input)
    expect(a.output.connect).toHaveBeenCalledWith(b.input)
    expect(b.output.connect).toHaveBeenCalledWith(destination)
  })
})
