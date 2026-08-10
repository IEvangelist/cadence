import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import './OnboardingTour.css'
import { type OnboardingStorage } from './onboardingStorage'
import { ONBOARDING_STEPS } from './steps'
import { type AnchorRect, useOnboarding } from './useOnboarding'

interface OnboardingTourProps {
  storage?: OnboardingStorage
  autoOpenDelay?: number
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('aria-hidden'),
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getSpotlightStyle(rect: AnchorRect): CSSProperties {
  const pad = 8
  return {
    height: `${rect.height + pad * 2}px`,
    left: `${rect.left - pad}px`,
    top: `${rect.top - pad}px`,
    width: `${rect.width + pad * 2}px`,
  }
}

export function OnboardingTour({
  storage,
  autoOpenDelay,
}: OnboardingTourProps = {}) {
  const {
    anchorRect,
    back,
    close,
    currentStep,
    finish,
    goTo,
    isFirstStep,
    isLastStep,
    isOpen,
    next,
    open,
    skip,
    stepCount,
    stepIndex,
  } = useOnboarding({ storage, autoOpenDelay, steps: ONBOARDING_STEPS })

  const dialogRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const [cardStyle, setCardStyle] = useState<CSSProperties>({})

  const titleId = `onboarding-tour-title-${currentStep.id}`
  const bodyId = `onboarding-tour-body-${currentStep.id}`

  const updateCardPosition = useCallback(() => {
    const dialog = dialogRef.current
    if (!isOpen || !anchorRect || !dialog || window.innerWidth < 640) {
      setCardStyle({})
      return
    }

    const gap = 16
    const cardRect = dialog.getBoundingClientRect()
    const cardWidth = cardRect.width || 384
    const cardHeight = cardRect.height || 280
    const availableRight = window.innerWidth - cardWidth - gap
    const availableBottom = window.innerHeight - cardHeight - gap
    const anchorCenter = anchorRect.left + anchorRect.width / 2

    let top = anchorRect.bottom + gap
    if (top > availableBottom) {
      top = anchorRect.top - cardHeight - gap
    }

    setCardStyle({
      left: `${clamp(anchorCenter - cardWidth / 2, gap, availableRight)}px`,
      top: `${clamp(top, gap, availableBottom)}px`,
    })
  }, [anchorRect, isOpen])

  useLayoutEffect(() => {
    updateCardPosition()
  }, [updateCardPosition])

  useEffect(() => {
    if (!isOpen) return undefined

    window.addEventListener('resize', updateCardPosition)
    window.addEventListener('scroll', updateCardPosition, true)

    return () => {
      window.removeEventListener('resize', updateCardPosition)
      window.removeEventListener('scroll', updateCardPosition, true)
    }
  }, [isOpen, updateCardPosition])

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement &&
        document.activeElement !== document.body
          ? document.activeElement
          : null

      const timer = window.setTimeout(() => {
        const dialog = dialogRef.current
        const primaryAction = dialog?.querySelector<HTMLElement>(
          '[data-primary-action="true"]',
        )
        const focusTarget = primaryAction ?? dialog
        focusTarget?.focus()
      }, 0)

      return () => window.clearTimeout(timer)
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false
      const previousFocus = previousFocusRef.current
      const focusTarget =
        previousFocus && document.contains(previousFocus)
          ? previousFocus
          : launcherRef.current
      focusTarget?.focus()
    }

    return undefined
  }, [isOpen])

  const trapFocus = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const dialog = dialogRef.current
    if (!dialog) return

    const focusableElements = getFocusableElements(dialog)
    const first = focusableElements[0] ?? dialog
    const last = focusableElements[focusableElements.length - 1] ?? dialog

    if (event.shiftKey) {
      if (document.activeElement === first || !dialog.contains(document.activeElement)) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (document.activeElement === last || !dialog.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Tab') {
        trapFocus(event)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (isLastStep) {
          finish()
        } else {
          next()
        }
      }
    },
    [back, close, finish, isLastStep, next, trapFocus],
  )

  const stopDialogClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }, [])

  return (
    <>
      <button
        ref={launcherRef}
        className="onboarding-tour__launcher"
        type="button"
        onClick={open}
      >
        Take a tour
      </button>

      {isOpen ? (
        <div className="onboarding-tour" data-testid="onboarding-tour-root">
          <button
            className="onboarding-tour__backdrop"
            type="button"
            aria-label="Dismiss onboarding tour"
            onClick={close}
          />
          {anchorRect ? (
            <div
              className="onboarding-tour__spotlight"
              style={getSpotlightStyle(anchorRect)}
              aria-hidden="true"
            />
          ) : null}
          <div
            ref={dialogRef}
            className={
              anchorRect
                ? 'onboarding-tour__dialog onboarding-tour__dialog--anchored'
                : 'onboarding-tour__dialog onboarding-tour__dialog--centered'
            }
            style={cardStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            tabIndex={-1}
            onClick={stopDialogClick}
            onKeyDown={handleKeyDown}
          >
            <button
              className="onboarding-tour__close"
              type="button"
              aria-label="Close onboarding tour"
              onClick={close}
            >
              ×
            </button>
            <p className="onboarding-tour__step" aria-live="polite">
              Step {stepIndex + 1} of {stepCount}
            </p>
            <h2 id={titleId}>{currentStep.title}</h2>
            <p id={bodyId} className="onboarding-tour__body">
              {currentStep.body}
            </p>
            <div className="onboarding-tour__dots" aria-label="Tour progress">
              {ONBOARDING_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  className="onboarding-tour__dot"
                  type="button"
                  aria-label={`Go to step ${index + 1}: ${step.title}`}
                  aria-current={index === stepIndex ? 'step' : undefined}
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
            <div className="onboarding-tour__actions">
              <button
                className="onboarding-tour__button onboarding-tour__button--ghost"
                type="button"
                onClick={skip}
              >
                Skip tour
              </button>
              <div className="onboarding-tour__nav">
                <button
                  className="onboarding-tour__button onboarding-tour__button--secondary"
                  type="button"
                  onClick={back}
                  disabled={isFirstStep}
                >
                  Back
                </button>
                <button
                  className="onboarding-tour__button onboarding-tour__button--primary"
                  type="button"
                  onClick={isLastStep ? finish : next}
                  data-primary-action="true"
                >
                  {isLastStep ? 'Get started' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default OnboardingTour
