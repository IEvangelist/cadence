import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { QuickStartGallery } from './QuickStartGallery'
import { HOUSE_DUBS } from '../templates'
import type { SongTemplate } from '../templates'

describe('<QuickStartGallery />', () => {
  it('exposes a labelled region so it is discoverable and navigable', () => {
    render(<QuickStartGallery onLoad={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Quick Starts' })).toBeInTheDocument()
  })

  it('groups templates under a heading per genre', () => {
    render(<QuickStartGallery onLoad={vi.fn()} />)
    for (const genre of new Set(HOUSE_DUBS.map((t) => t.genre))) {
      expect(screen.getByRole('heading', { level: 3, name: genre })).toBeInTheDocument()
    }
  })

  it('renders one button per template, showing its name and tempo', () => {
    render(<QuickStartGallery onLoad={vi.fn()} />)
    for (const template of HOUSE_DUBS) {
      const button = screen.getByRole('button', { name: new RegExp(template.name) })
      expect(within(button).getByText(`${template.tempo} BPM`)).toBeInTheDocument()
      expect(within(button).getByText(template.description)).toBeInTheDocument()
    }
  })

  it('loads the chosen template on click', async () => {
    coversInteractions('studio.quick-start.load')
    const user = userEvent.setup()
    const onLoad = vi.fn()
    render(<QuickStartGallery onLoad={onLoad} />)
    const target = HOUSE_DUBS[0]
    await user.click(screen.getByRole('button', { name: new RegExp(target.name) }))
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(onLoad).toHaveBeenCalledWith(target)
  })

  it('honours an injected template list for focused rendering', async () => {
    const user = userEvent.setup()
    const fake: SongTemplate[] = [
      {
        id: 'demo-a',
        name: 'Demo A',
        description: 'First',
        genre: 'Test Genre',
        tempo: 100,
        build: HOUSE_DUBS[0].build,
      },
    ]
    const onLoad = vi.fn()
    render(<QuickStartGallery onLoad={onLoad} templates={fake} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Test Genre' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Demo A/ }))
    expect(onLoad).toHaveBeenCalledWith(fake[0])
  })
})
