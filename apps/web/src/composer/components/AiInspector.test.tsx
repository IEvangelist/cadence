import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import type { AssistantController } from '../hooks/useAssistant'
import type { AiStudioController } from '../hooks/useAiStudio'
import { AiInspector } from './AiInspector'

const assistant = {
  action: 'generate',
  setAction: () => undefined,
  params: { temperature: 1, lengthBeats: 4 },
  setTemperature: () => undefined,
  setLength: () => undefined,
  phase: 'idle',
  statusMessage: 'Ready',
  isBusy: false,
  error: null,
  suggestion: null,
  previewNotes: [],
  canGenerate: true,
  generate: async () => undefined,
  cancel: () => undefined,
  accept: () => undefined,
  discard: () => undefined,
  audition: () => undefined,
  providerId: 'mock',
} satisfies AssistantController

const studio = {
  unlimited: false,
  feature: 'text-to-motif',
  setFeature: () => undefined,
  canUse: () => true,
  prompt: '',
  setPrompt: () => undefined,
  motifLength: 4,
  setMotifLength: () => undefined,
  createMotif: () => undefined,
  styleId: 'jazz-swing',
  setStyleId: () => undefined,
  applyStyleToTrack: () => undefined,
  groovePresetId: 'human',
  setGroovePresetId: () => undefined,
  grooveIntensity: 0.5,
  setGrooveIntensity: () => undefined,
  applyGrooveToTrack: () => undefined,
  report: null,
  analyze: () => undefined,
  status: 'Ready',
} satisfies AiStudioController

describe('<AiInspector />', () => {
  it('keeps Basic active until Advanced is requested', async () => {
    coversInteractions('studio.ai.inspector.tab')
    render(<AiInspector assistant={assistant} studio={studio} />)

    expect(screen.getByRole('tab', { name: 'Basic' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'AI Assistant' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'AI Studio' })).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))

    expect(screen.getByRole('tab', { name: 'Advanced' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('region', { name: 'AI Studio' })).toBeVisible()
    expect(document.getElementById('ai-inspector-basic-panel')).not.toBeVisible()
  })

  it('keeps the Advanced panel mounted after returning to Basic', async () => {
    render(<AiInspector assistant={assistant} studio={studio} initialView="advanced" />)
    expect(await screen.findByRole('region', { name: 'AI Studio' })).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Basic' }))

    expect(screen.getByRole('region', { name: 'AI Assistant' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'AI Studio', hidden: true })).not.toBeVisible()
  })

  it('keeps Basic generate, preview, accept, discard, and cancel on the same controller', () => {
    const generate = vi.fn(async () => undefined)
    const cancel = vi.fn()
    const audition = vi.fn()
    const accept = vi.fn()
    const discard = vi.fn()
    const basic: AssistantController = {
      ...assistant,
      generate,
      cancel,
      audition,
      accept,
      discard,
      suggestion: {
        action: 'generate',
        label: 'Generated idea',
        notes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.8 }],
      },
      previewNotes: [{ pitch: 60, start: 0, duration: 1, velocity: 0.8 }],
    }
    const { rerender } = render(<AiInspector assistant={basic} studio={studio} />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(audition).toHaveBeenCalledTimes(1)
    expect(accept).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledTimes(1)

    rerender(
      <AiInspector
        assistant={{ ...basic, isBusy: true, phase: 'generating' }}
        studio={studio}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('invokes Advanced actions only after switching presentation', async () => {
    const createMotif = vi.fn()
    render(
      <AiInspector
        assistant={assistant}
        studio={{ ...studio, createMotif }}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Create motif' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create motif' }))
    expect(createMotif).toHaveBeenCalledTimes(1)
  })
})
