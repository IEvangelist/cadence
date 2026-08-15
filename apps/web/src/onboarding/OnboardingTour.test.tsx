import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { OnboardingTour } from './OnboardingTour'
import {
  MemoryOnboardingStorage,
  ONBOARDING_SEEN_KEY,
  createDefaultOnboardingStorage,
  markOnboardingSeen,
  readOnboardingSeen,
  type OnboardingStorage,
} from './onboardingStorage'
import { getAnchorRect } from './useOnboarding'

class ThrowingStorage implements OnboardingStorage {
  getItem(): string | null {
    throw new Error('read denied')
  }

  setItem(): void {
    throw new Error('write denied')
  }
}

function renderTour(storage: OnboardingStorage = new MemoryOnboardingStorage()) {
  render(<OnboardingTour storage={storage} autoOpenDelay={0} />)
  return storage
}

async function findDialog() {
  return screen.findByRole('dialog')
}

describe('<OnboardingTour />', () => {
  it('auto-opens on first run and stays closed for returning users', async () => {
    renderTour()
    expect(await findDialog()).toBeInTheDocument()

    const storage = new MemoryOnboardingStorage()
    storage.setItem(ONBOARDING_SEEN_KEY, '1')
    render(<OnboardingTour storage={storage} autoOpenDelay={0} />)

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Take a tour' })).toHaveLength(2)
    })
    expect(screen.queryAllByRole('dialog')).toHaveLength(1)
  })

  it('moves next, back, and directly across steps', async () => {
    coversInteractions('onboarding.next', 'onboarding.back', 'onboarding.step.select')
    renderTour()
    await findDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Project toolbar' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()

    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }

    expect(screen.getByRole('button', { name: 'Get started' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Go to step 3/ }))
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument()
  })

  it('finishes from the last step and persists the seen flag', async () => {
    const storage = renderTour()
    await findDialog()

    fireEvent.click(screen.getByRole('button', { name: /Go to step 7/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(storage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')
  })

  it('skips, closes, and dismisses from the backdrop with persistence', async () => {
    const skipStorage = renderTour()
    await findDialog()
    coversInteractions('onboarding.skip')
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(skipStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')

    const closeStorage = new MemoryOnboardingStorage()
    render(<OnboardingTour storage={closeStorage} autoOpenDelay={0} />)
    await findDialog()
    coversInteractions('onboarding.close')
    fireEvent.click(screen.getByRole('button', { name: 'Close onboarding tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(closeStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')

    const backdropStorage = new MemoryOnboardingStorage()
    render(<OnboardingTour storage={backdropStorage} autoOpenDelay={0} />)
    await findDialog()
    coversInteractions('onboarding.dismiss-backdrop')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss onboarding tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(backdropStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')
  })

  it('supports Escape and arrow-key navigation', async () => {
    coversInteractions('onboarding.dialog.keyboard')
    const storage = renderTour()
    const dialog = await findDialog()

    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(screen.getByText('Step 1 of 7')).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(storage.getItem(ONBOARDING_SEEN_KEY)).toBe('1')
  })

  it('opens from the launcher even after the seen flag is set', async () => {
    coversInteractions('onboarding.launch')
    const storage = new MemoryOnboardingStorage()
    storage.setItem(ONBOARDING_SEEN_KEY, '1')
    render(<OnboardingTour storage={storage} autoOpenDelay={0} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Take a tour' }))

    expect(await findDialog()).toBeInTheDocument()
  })

  it('falls back to a centered card when an anchor is missing', async () => {
    renderTour()
    await findDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByRole('dialog')).toHaveClass('onboarding-tour__dialog--centered')
  })

  it('spotlights an available anchor', async () => {
    const storage = new MemoryOnboardingStorage()
    const { container } = render(
      <>
        <div aria-label="Project toolbar" data-testid="project-toolbar-anchor" />
        <OnboardingTour storage={storage} autoOpenDelay={0} />
      </>,
    )
    const anchor = screen.getByTestId('project-toolbar-anchor')
    anchor.getBoundingClientRect = () =>
      ({
        bottom: 42,
        height: 32,
        left: 20,
        right: 140,
        top: 10,
        width: 120,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect

    await findDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() =>
      expect(container.querySelector('.onboarding-tour__spotlight')).toBeInTheDocument(),
    )
    expect(screen.getByRole('dialog')).toHaveClass('onboarding-tour__dialog--anchored')
  })

  it('swallows storage read and write failures', async () => {
    renderTour(new ThrowingStorage())

    expect(await findDialog()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('moves focus into the dialog and restores it after close', async () => {
    const storage = new MemoryOnboardingStorage()
    render(<OnboardingTour storage={storage} autoOpenDelay={0} />)
    const launcher = screen.getByRole('button', { name: 'Take a tour' })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(launcher).toHaveFocus())

    fireEvent.click(launcher)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus(),
    )
    screen.getByRole('button', { name: 'Close onboarding tour' }).focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close onboarding tour' }))
    await waitFor(() => expect(launcher).toHaveFocus())
  })
})

describe('onboarding storage helpers', () => {
  it('read and write the seen flag defensively', () => {
    const storage = new MemoryOnboardingStorage()

    expect(readOnboardingSeen(storage)).toBe(false)
    markOnboardingSeen(storage)
    expect(readOnboardingSeen(storage)).toBe(true)
    expect(readOnboardingSeen(new ThrowingStorage())).toBe(false)
    expect(() => markOnboardingSeen(new ThrowingStorage())).not.toThrow()
  })

  it('creates a browser-backed storage when localStorage is available', () => {
    expect(createDefaultOnboardingStorage()).toBe(window.localStorage)
  })
})

describe('getAnchorRect', () => {
  it('returns null without a document, missing anchor, empty rect, or invalid selector', () => {
    expect(getAnchorRect('[aria-label="Project toolbar"]', null)).toBeNull()
    expect(getAnchorRect('[aria-label="Missing"]', document)).toBeNull()
    expect(getAnchorRect('[', document)).toBeNull()

    const element = document.createElement('div')
    element.setAttribute('aria-label', 'Empty anchor')
    document.body.append(element)
    expect(getAnchorRect('[aria-label="Empty anchor"]', document)).toBeNull()
    element.remove()
  })
})
