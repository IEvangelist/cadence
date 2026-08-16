import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import type { InstrumentDefinition, InstrumentKind } from '../plugins/types'
import { defaultPluginHost } from '../plugins/defaultHost'
import { listInstruments } from '../instruments/registry'
import {
  ALL_INSTRUMENTS_FILTER,
  filterInstruments,
  groupInstrumentsForBrowser,
  listInstrumentGroups,
} from '../instruments/browserModel'
import {
  getInstrumentLoadState,
  subscribeInstrumentLoadState,
  type InstrumentLoadState,
} from '../instruments/instrumentLoadState'
import './EditorWorkspace.css'

interface InstrumentBrowserProps {
  selectedId: string
  onSelect: (instrumentId: string) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  getInstruments?: () => InstrumentDefinition[]
  subscribe?: (listener: () => void) => () => void
  getLoadState?: (instrumentId: string) => InstrumentLoadState
}

const loadStateLabel: Record<InstrumentLoadState, string> = {
  idle: 'Loads on selection',
  loading: 'Loading samples',
  ready: 'Ready',
  error: 'Samples unavailable',
}

export function InstrumentBrowser({
  selectedId,
  onSelect,
  onClose,
  returnFocusRef,
  getInstruments = listInstruments,
  subscribe = (listener) => defaultPluginHost.subscribe(listener),
  getLoadState = getInstrumentLoadState,
}: InstrumentBrowserProps) {
  const listboxId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<InstrumentKind | 'all'>('all')
  const [group, setGroup] = useState<string | 'all'>('all')
  const [instruments, setInstruments] = useState(getInstruments)
  const [, setLoadVersion] = useState(0)
  const filtered = useMemo(
    () => filterInstruments(instruments, query, { kind, group }),
    [group, instruments, kind, query],
  )
  const grouped = useMemo(() => groupInstrumentsForBrowser(filtered), [filtered])
  const navigationInstruments = useMemo(
    () => grouped.flatMap((instrumentGroup) => instrumentGroup.instruments),
    [grouped],
  )
  const groups = useMemo(() => listInstrumentGroups(instruments), [instruments])
  const [activeId, setActiveId] = useState(selectedId)
  const resolvedActiveId = navigationInstruments.some((instrument) => instrument.id === activeId)
    ? activeId
    : (navigationInstruments[0]?.id ?? '')

  useEffect(() => subscribe(() => setInstruments(getInstruments())), [getInstruments, subscribe])
  useEffect(
    () => subscribeInstrumentLoadState(() => setLoadVersion((version) => version + 1)),
    [],
  )
  useEffect(() => {
    searchRef.current?.focus()
  }, [])
  const close = (): void => {
    onClose()
    queueMicrotask(() => returnFocusRef?.current?.focus())
  }

  const selectActive = (): void => {
    if (!resolvedActiveId) return
    onSelect(resolvedActiveId)
    close()
  }

  const moveActive = (offset: number): void => {
    if (navigationInstruments.length === 0) return
    const index = navigationInstruments.findIndex(
      (instrument) => instrument.id === resolvedActiveId,
    )
    const next = Math.min(
      navigationInstruments.length - 1,
      Math.max(0, (index < 0 ? 0 : index) + offset),
    )
    setActiveId(navigationInstruments[next].id)
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveId(navigationInstruments[0]?.id ?? '')
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveId(navigationInstruments.at(-1)?.id ?? '')
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectActive()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <section className="instrument-browser" aria-label="Instrument browser">
      <header className="instrument-browser__header">
        <div>
          <h2>Choose an instrument</h2>
          <p>Search the active instrument registry.</p>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          data-interaction="studio.instrument-browser.close"
          onClick={close}
        >
          Close
        </button>
      </header>

      <label htmlFor={`${listboxId}-search`}>Search instruments</label>
      <input
        ref={searchRef}
        id={`${listboxId}-search`}
        type="search"
        role="combobox"
        data-interaction="studio.instrument-browser.search"
        aria-controls={listboxId}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-activedescendant={resolvedActiveId ? `${listboxId}-${resolvedActiveId}` : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="instrument-browser__filters" aria-label="Instrument filters">
        {([
          ['all', 'All'],
          ['synth', 'Melodic'],
          ['drum', 'Drums'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm${kind === value ? ' is-active' : ''}`}
            data-interaction="studio.instrument-browser.kind"
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {label}
          </button>
        ))}
        <label htmlFor={`${listboxId}-group`}>Group</label>
        <select
          id={`${listboxId}-group`}
          data-interaction="studio.instrument-browser.group"
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value={ALL_INSTRUMENTS_FILTER.group}>All groups</option>
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div
        id={listboxId}
        className="instrument-browser__list"
        role="listbox"
        data-interaction="studio.instrument-browser.list"
        aria-label="Available instruments"
        onKeyDown={handleKeyDown}
      >
        {grouped.map((instrumentGroup) => (
          <div
            key={instrumentGroup.name}
            className="instrument-browser__group"
            role="group"
            aria-label={instrumentGroup.name}
          >
            <p className="instrument-browser__group-name">{instrumentGroup.name}</p>
            {instrumentGroup.instruments.map((instrument) => {
              const active = resolvedActiveId === instrument.id
              const selected = selectedId === instrument.id
              const loadState = getLoadState(instrument.id)
              return (
                <button
                  key={instrument.id}
                  id={`${listboxId}-${instrument.id}`}
                  type="button"
                  role="option"
                  className={`instrument-browser__option${active ? ' is-active' : ''}`}
                  data-interaction="studio.instrument-browser.option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onPointerMove={() => setActiveId(instrument.id)}
                  onClick={() => {
                    onSelect(instrument.id)
                    close()
                  }}
                >
                  <span className="instrument-browser__option-title">{instrument.name}</span>
                  <span className="instrument-browser__option-meta">
                    {instrument.kind === 'drum' ? 'Drum' : 'Melodic'} ·{' '}
                    {loadStateLabel[loadState]}
                  </span>
                  <span className="instrument-browser__option-description">
                    {instrument.description}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
        {filtered.length === 0 ? (
          <p className="instrument-browser__empty" role="status">
            No instruments match this search.
          </p>
        ) : null}
      </div>
    </section>
  )
}
