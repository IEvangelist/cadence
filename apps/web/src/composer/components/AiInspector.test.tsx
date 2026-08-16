import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
  statusMessage: 'Ready',
  isBusy: false,
  suggestion: null,
  canGenerate: true,
  generate: async () => undefined,
  cancel: () => undefined,
  accept: () => undefined,
  discard: () => undefined,
  audition: () => undefined,
} as unknown as AssistantController

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
} as unknown as AiStudioController

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
})
