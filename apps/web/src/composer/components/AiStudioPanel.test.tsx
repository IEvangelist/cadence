import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { Composer } from '../Composer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote, createTrack } from '../model/project'
import type { Project } from '../model/project'
import type { Entitlements } from '../../billing/entitlementsClient'

function proEntitlements(): Entitlements {
  return {
    tier: 'Pro',
    watermarkExports: false,
    maxProjects: 100,
    aiGenerationsPerDay: -1,
    advancedFormats: true,
    stemSeparation: true,
    collaborationSeats: 5,
  }
}

function projectWithNotes(): Project {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      {
        name: 'Lead',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'n0'),
          createNote({ pitch: 64, start: 1, duration: 1, velocity: 0.6 }, 'n1'),
          createNote({ pitch: 67, start: 2, duration: 1, velocity: 0.7 }, 'n2'),
        ],
      },
      't1',
    ),
  ]
  return project
}

function renderStudio(opts: { entitlements?: Entitlements | null; project?: Project } = {}) {
  return render(
    <Composer
      options={{
        createEngine: () => new SilentAudioEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: opts.project ?? projectWithNotes(),
        autosaveDelay: 0,
      }}
      aiStudioOptions={{ entitlements: opts.entitlements ?? null }}
    />,
  )
}

function studioRanelRegion() {
  const inspector = screen.getByRole('button', { name: 'Inspector' })
  if (inspector.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(inspector)
  }
  fireEvent.click(screen.getByRole('tab', { name: 'AI Studio' }))
  return screen.getByRole('region', { name: 'AI Studio' })
}

describe('<AiStudioPanel />', () => {
  it('renders the AI Studio with a feature radiogroup', () => {
    renderStudio()
    const panel = studioRanelRegion()
    expect(within(panel).getByRole('heading', { name: 'AI Studio' })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Text to motif/ })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Style transfer/ })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Groove/ })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Auto-master/ })).toBeInTheDocument()
  })

  it('shows a Free badge and locks pro features on the free tier', () => {
    coversInteractions('studio.ai.feature.select')
    renderStudio({ entitlements: null })
    const panel = studioRanelRegion()
    expect(within(panel).getByText(/Free · on-device/)).toBeInTheDocument()
    // Text-to-motif is free: its Create button is present and enabled.
    expect(within(panel).getByRole('button', { name: 'Create motif' })).toBeEnabled()

    // Switching to a pro feature shows the upgrade note and disables the action.
    fireEvent.click(within(panel).getByRole('radio', { name: /Style transfer/ }))
    expect(within(panel).getByText(/available on the Pro plan/)).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Apply style' })).toBeDisabled()
  })

  it('generates a motif from a prompt through the composer controller', () => {
    coversInteractions(
      'studio.ai.motif.prompt',
      'studio.ai.motif.length',
      'studio.ai.motif.create',
    )
    renderStudio({ entitlements: null })
    const panel = studioRanelRegion()

    const prompt = within(panel).getByRole('textbox', { name: 'Prompt' })
    const length = within(panel).getByRole('slider', { name: /Motif length/ })
    fireEvent.change(prompt, {
      target: { value: 'a dark melody in D minor' },
    })
    fireEvent.change(length, {
      target: { value: '6' },
    })
    expect(prompt).toHaveValue('a dark melody in D minor')
    expect(length).toHaveValue('6')
    expect(within(panel).getByText('6 beats')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Create motif' }))

    expect(within(panel).getByRole('status')).toHaveTextContent(
      /Added \d+-note motif in D Minor/,
    )
  })

  it('applies a style on the pro tier', () => {
    coversInteractions('studio.ai.style.select', 'studio.ai.style.apply')
    renderStudio({ entitlements: proEntitlements() })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Style transfer/ }))
    const select = within(panel).getByRole('combobox', { name: 'Style' })
    expect(select).toBeEnabled()
    fireEvent.change(select, { target: { value: 'jazz-swing' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply style' }))

    expect(within(panel).getByRole('status')).toHaveTextContent(/Applied Jazz swing/)
  })

  it('applies a groove with an intensity control on any tier', () => {
    coversInteractions(
      'studio.ai.groove.select',
      'studio.ai.groove.intensity',
      'studio.ai.groove.apply',
    )
    renderStudio({ entitlements: null })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Groove/ }))
    const groove = within(panel).getByRole('combobox', { name: 'Groove' })
    const intensity = within(panel).getByRole('slider', { name: /Intensity/ })
    fireEvent.change(groove, {
      target: { value: 'human' },
    })
    fireEvent.change(intensity, {
      target: { value: '0.5' },
    })
    expect(groove).toHaveValue('human')
    expect(intensity).toHaveValue('0.5')
    expect(within(panel).getByText('50%')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply groove' }))

    expect(within(panel).getByRole('status')).toHaveTextContent(/Applied Human groove/)
  })

  it('produces a mastering report on the pro tier', () => {
    coversInteractions('studio.ai.mastering.analyze')
    renderStudio({ entitlements: proEntitlements() })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Auto-master/ }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Analyze mix' }))

    expect(within(panel).getByRole('status')).toHaveTextContent(/track/i)
    expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('locks auto-master on the free tier', () => {
    renderStudio({ entitlements: null })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Auto-master/ }))
    expect(within(panel).getByRole('button', { name: 'Analyze mix' })).toBeDisabled()
    expect(within(panel).getByText(/available on the Pro plan/)).toBeInTheDocument()
  })

  it('reports when there are no notes to restyle', () => {
    renderStudio({ entitlements: proEntitlements(), project: createEmptyProject('empty') })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Style transfer/ }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply style' }))
    expect(within(panel).getByRole('status')).toHaveTextContent(/Add notes to the selected track/)
  })

  it('reports when there are no notes to groove', () => {
    renderStudio({ entitlements: null, project: createEmptyProject('empty') })
    const panel = studioRanelRegion()

    fireEvent.click(within(panel).getByRole('radio', { name: /Groove/ }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply groove' }))
    expect(within(panel).getByRole('status')).toHaveTextContent(/Add notes to the selected track/)
  })
})
