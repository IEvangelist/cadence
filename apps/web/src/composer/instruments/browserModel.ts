import type { InstrumentDefinition, InstrumentKind } from '../plugins/types'

export interface InstrumentBrowserFilter {
  kind: InstrumentKind | 'all'
  group: string | 'all'
}

export interface InstrumentGroup {
  name: string
  instruments: InstrumentDefinition[]
}

export const ALL_INSTRUMENTS_FILTER: InstrumentBrowserFilter = {
  kind: 'all',
  group: 'all',
}

export function normalizeInstrumentSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase()
}

function searchableText(instrument: InstrumentDefinition): string {
  const kind = instrument.kind === 'drum' ? 'drum drums percussion' : 'synth melodic'
  return normalizeInstrumentSearch(
    [instrument.name, instrument.group ?? '', instrument.description, kind].join(' '),
  )
}

export function filterInstruments(
  instruments: readonly InstrumentDefinition[],
  query: string,
  filter: InstrumentBrowserFilter = ALL_INSTRUMENTS_FILTER,
): InstrumentDefinition[] {
  const search = normalizeInstrumentSearch(query)
  return instruments.filter((instrument) => {
    if (filter.kind !== 'all' && instrument.kind !== filter.kind) return false
    if (filter.group !== 'all' && (instrument.group ?? 'Other') !== filter.group) return false
    return search.length === 0 || searchableText(instrument).includes(search)
  })
}

export function groupInstrumentsForBrowser(
  instruments: readonly InstrumentDefinition[],
): InstrumentGroup[] {
  const groups = new Map<string, InstrumentDefinition[]>()
  for (const instrument of instruments) {
    const group = instrument.group ?? 'Other'
    const items = groups.get(group) ?? []
    items.push(instrument)
    groups.set(group, items)
  }
  return [...groups].map(([name, items]) => ({ name, instruments: items }))
}

export function listInstrumentGroups(
  instruments: readonly InstrumentDefinition[],
): string[] {
  return [...new Set(instruments.map((instrument) => instrument.group ?? 'Other'))]
}

