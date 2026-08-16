import { describe, expect, it } from 'vitest'
import type { InstrumentDefinition } from '../plugins/types'
import {
  filterInstruments,
  groupInstrumentsForBrowser,
  listInstrumentGroups,
} from './browserModel'

const instruments: InstrumentDefinition[] = [
  {
    id: 'warm-pad',
    name: 'Ámber Pad',
    group: 'Pads',
    kind: 'synth',
    description: 'Slow evolving analog texture',
    polyphonic: true,
  },
  {
    id: 'studio-kit',
    name: 'Studio Kit',
    group: 'Drums',
    kind: 'drum',
    description: 'Tight acoustic percussion',
    polyphonic: true,
  },
  {
    id: 'sub',
    name: 'Sub',
    kind: 'synth',
    description: 'Deep bass',
    polyphonic: false,
  },
]

describe('instrument browser model', () => {
  it('searches normalized name, group, description, and kind', () => {
    expect(filterInstruments(instruments, 'amber').map((item) => item.id)).toEqual(['warm-pad'])
    expect(filterInstruments(instruments, 'pads').map((item) => item.id)).toEqual(['warm-pad'])
    expect(filterInstruments(instruments, 'acoustic').map((item) => item.id)).toEqual(['studio-kit'])
    expect(filterInstruments(instruments, 'melodic').map((item) => item.id)).toEqual([
      'warm-pad',
      'sub',
    ])
  })

  it('combines kind and group filters and supports an empty result', () => {
    expect(
      filterInstruments(instruments, '', { kind: 'drum', group: 'Drums' }).map(
        (item) => item.id,
      ),
    ).toEqual(['studio-kit'])
    expect(filterInstruments(instruments, 'piano')).toEqual([])
  })

  it('groups in live-registry order and includes ungrouped instruments', () => {
    expect(groupInstrumentsForBrowser(instruments).map((group) => group.name)).toEqual([
      'Pads',
      'Drums',
      'Other',
    ])
    expect(listInstrumentGroups(instruments)).toEqual(['Pads', 'Drums', 'Other'])
  })
})

