import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ filterDispose: vi.fn() }))

vi.mock('tone', () => {
  class Filter {
    frequency: number
    type: string
    constructor(frequency: number, type: string) {
      this.frequency = frequency
      this.type = type
    }
    dispose = h.filterDispose
  }
  return { Filter }
})

import { BUILTIN_EFFECTS } from './effects'

describe('built-in effects', () => {
  it('ships exactly one effect that is disabled by default', () => {
    expect(BUILTIN_EFFECTS).toHaveLength(1)
    const [softener] = BUILTIN_EFFECTS
    expect(softener.id).toBe('softener')
    expect(softener.name).toBeTruthy()
    expect(softener.enabledByDefault).toBe(false)
  })

  it('creates an effect node exposing input, output and dispose', () => {
    const [softener] = BUILTIN_EFFECTS
    const node = softener.createNode({ tempo: 120 })

    expect(node.input).toBeDefined()
    expect(node.output).toBeDefined()
    // A simple filter uses the same node for input and output.
    expect(node.input).toBe(node.output)

    node.dispose()
    expect(h.filterDispose).toHaveBeenCalledTimes(1)
  })
})
