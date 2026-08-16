import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstrumentDefinition } from '../plugins/types'
import { InstrumentBrowser } from './InstrumentBrowser'

const lazyPack = vi.hoisted(() => ({ loaded: 0 }))
vi.mock('../plugins/builtins/samplePacks/pianoPacks', () => {
  lazyPack.loaded += 1
  return {
    loadGrandPiano: vi.fn(),
    loadElectricPiano: vi.fn(),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  lazyPack.loaded = 0
})

const instruments: InstrumentDefinition[] = [
  {
    id: 'piano',
    name: 'Studio Piano',
    group: 'Keys',
    kind: 'synth',
    description: 'Focused acoustic keys',
    polyphonic: true,
  },
  {
    id: 'drums',
    name: 'Live Kit',
    group: 'Drums',
    kind: 'drum',
    description: 'Acoustic drum room',
    polyphonic: true,
  },
  {
    id: 'sampled',
    name: 'Sampled Keys',
    group: 'Keys',
    kind: 'synth',
    description: 'Lazy sample pack',
    polyphonic: true,
  },
]

function setup(options: Partial<Parameters<typeof InstrumentBrowser>[0]> = {}) {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(
    <InstrumentBrowser
      selectedId="piano"
      onSelect={onSelect}
      onClose={onClose}
      getInstruments={() => instruments}
      subscribe={() => () => {}}
      getLoadState={(id) => (id === 'sampled' ? 'idle' : 'ready')}
      {...options}
    />,
  )
  return { onSelect, onClose }
}

describe('<InstrumentBrowser />', () => {
  it('searches metadata and filters by kind and group without selecting or loading', async () => {
    const user = userEvent.setup()
    const loadState = vi.fn(() => 'ready' as const)
    const { onSelect } = setup({ getLoadState: loadState })

    await user.type(screen.getByRole('combobox', { name: 'Search instruments' }), 'acoustic')
    expect(screen.getByRole('option', { name: /Studio Piano/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Live Kit/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sampled Keys/ })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('combobox', { name: 'Search instruments' }))
    await user.click(screen.getByRole('button', { name: 'Drums' }))
    expect(screen.getByRole('listbox').querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(loadState).toHaveBeenCalled()
  })

  it('supports listbox navigation, selection, Escape, and an empty result', async () => {
    const user = userEvent.setup()
    const { onSelect, onClose } = setup()
    const search = screen.getByRole('combobox', { name: 'Search instruments' })

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('drums')
    expect(onClose).toHaveBeenCalledOnce()

    await user.type(search, 'not in registry')
    expect(screen.getByRole('status')).toHaveTextContent('No instruments match this search.')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('updates safely when the live registry removes the active plugin instrument', () => {
    let live = [...instruments]
    let notify = () => {}
    const { rerender } = render(
      <InstrumentBrowser
        selectedId="piano"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        getInstruments={() => live}
        subscribe={(listener) => {
          notify = listener
          return () => {}
        }}
      />,
    )
    const search = screen.getByRole('combobox', { name: 'Search instruments' })
    fireEvent.keyDown(search, { key: 'End' })
    live = live.filter((instrument) => instrument.id !== 'sampled')
    notify()
    rerender(
      <InstrumentBrowser
        selectedId="piano"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        getInstruments={() => live}
        subscribe={() => () => {}}
      />,
    )
    expect(screen.queryByRole('option', { name: /Sampled Keys/ })).not.toBeInTheDocument()
    expect(search).toHaveAttribute('aria-activedescendant', expect.stringContaining('piano'))
  })

  it('does not load sampled chunks or fetch remote packs while opening and searching', async () => {
    const user = userEvent.setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(
      <InstrumentBrowser
        selectedId="poly-synth"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await user.type(
      screen.getByRole('combobox', { name: 'Search instruments' }),
      'sampled',
    )
    expect(screen.getByRole('listbox').querySelectorAll('[role="option"]').length)
      .toBeGreaterThan(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(lazyPack.loaded).toBe(0)
  })
})
