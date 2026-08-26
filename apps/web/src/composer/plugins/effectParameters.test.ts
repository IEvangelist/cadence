import { describe, expect, it, vi } from 'vitest'
import {
  createEffectNode,
  defaultEffectParams,
  effectParameterDescriptors,
  sanitizeEffectParameterValue,
  sanitizeEffectParams,
} from './effectParameters'
import type { EffectContribution } from './types'

const contribution = {
  id: 'test',
  name: 'Test',
  description: 'Test effect',
  parameters: [
    {
      type: 'number',
      id: 'amount',
      name: 'Amount',
      defaultValue: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
  createNode: () => {
    throw new Error('not needed')
  },
} satisfies EffectContribution

describe('effect parameter helpers', () => {
  it('creates defaults and clamps finite values', () => {
    expect(defaultEffectParams(contribution)).toEqual({ amount: 0.5 })
    expect(sanitizeEffectParameterValue(contribution.parameters[0], 4)).toBe(1)
    expect(sanitizeEffectParameterValue(contribution.parameters[0], Number.NaN)).toBe(0.5)
    expect(sanitizeEffectParameterValue(contribution.parameters[0], 0.646)).toBe(0.65)
    expect(
      sanitizeEffectParameterValue(
        contribution.parameters[0],
        '0.8' as unknown as number,
      ),
    ).toBe(0.5)
  })

  it('fills descriptor defaults while preserving plugin-owned unknown params', () => {
    expect(sanitizeEffectParams(contribution, { amount: -2, '_future:v2': 7 })).toEqual({
      amount: 0,
      '_future:v2': 7,
    })
  })

  it('filters malformed and duplicate runtime descriptors from the UI surface', () => {
    const malformed = {
      parameters: [
        contribution.parameters[0],
        { ...contribution.parameters[0] },
        { ...contribution.parameters[0], id: '__proto__' },
        { ...contribution.parameters[0], id: 'constructor' },
        { ...contribution.parameters[0], id: 'prototype' },
        { ...contribution.parameters[0], id: 'bad', step: 0 },
      ],
    } as unknown as Pick<EffectContribution, 'parameters'>
    expect(effectParameterDescriptors(malformed)).toEqual([contribution.parameters[0]])
  })

  it('wraps factories with a complete normalized descriptor snapshot', () => {
    const createNode = vi.fn(() => ({
      input: {},
      output: {},
      dispose: vi.fn(),
    }))
    const effect = {
      ...contribution,
      parameters: [
        contribution.parameters[0],
        {
          type: 'number' as const,
          id: 'tone',
          name: 'Tone',
          defaultValue: 2,
          min: 1,
          max: 3,
          step: 1,
        },
      ],
      createNode,
    }

    createEffectNode(effect as unknown as EffectContribution, {
      tempo: 120,
      params: { amount: 4 },
    })

    expect(createNode).toHaveBeenCalledWith({
      tempo: 120,
      params: { amount: 1, tone: 2 },
    })
  })
})
