import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createDefaultOnboardingStorage,
  markOnboardingSeen,
  readOnboardingSeen,
  type OnboardingStorage,
} from './onboardingStorage'
import { ONBOARDING_STEPS, type OnboardingStep } from './steps'

export interface AnchorRect {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface UseOnboardingOptions {
  storage?: OnboardingStorage
  autoOpenDelay?: number
  steps?: readonly OnboardingStep[]
}

function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}

export function getAnchorRect(selector: string, doc: Document | null): AnchorRect | null {
  if (!doc) return null

  try {
    const anchor = doc.querySelector(selector)
    if (!anchor) return null

    const rect = anchor.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) return null

    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
  } catch {
    return null
  }
}

export function useOnboarding({
  storage,
  autoOpenDelay = 40,
  steps = ONBOARDING_STEPS,
}: UseOnboardingOptions = {}) {
  const [storageBackend] = useState(() => storage ?? createDefaultOnboardingStorage())
  const [hasSeen, setHasSeen] = useState(() => readOnboardingSeen(storageBackend))
  const [isOpen, setIsOpen] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)

  const lastStepIndex = steps.length - 1
  const currentStep = steps[stepIndex] ?? steps[0]

  const open = useCallback(() => {
    setStepIndex(0)
    setIsOpen(true)
  }, [])

  const persistAndClose = useCallback(() => {
    markOnboardingSeen(storageBackend)
    setHasSeen(true)
    setIsOpen(false)
  }, [storageBackend])

  const next = useCallback(() => {
    setStepIndex((index) => Math.min(index + 1, lastStepIndex))
  }, [lastStepIndex])

  const back = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0))
  }, [])

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), lastStepIndex))
    },
    [lastStepIndex],
  )

  const finish = useCallback(() => {
    persistAndClose()
  }, [persistAndClose])

  const skip = useCallback(() => {
    persistAndClose()
  }, [persistAndClose])

  const close = useCallback(() => {
    persistAndClose()
  }, [persistAndClose])

  const measureAnchor = useCallback(() => {
    if (!isOpen || !currentStep.anchor) {
      setAnchorRect(null)
      return
    }

    setAnchorRect(getAnchorRect(currentStep.anchor, getDocument()))
  }, [currentStep.anchor, isOpen])

  useEffect(() => {
    if (hasSeen || isOpen) return undefined

    const timer = window.setTimeout(open, autoOpenDelay)
    return () => window.clearTimeout(timer)
  }, [autoOpenDelay, hasSeen, isOpen, open])

  useEffect(() => {
    if (!isOpen) return undefined

    const timer = window.setTimeout(measureAnchor, 0)
    window.addEventListener('resize', measureAnchor)
    window.addEventListener('scroll', measureAnchor, true)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', measureAnchor)
      window.removeEventListener('scroll', measureAnchor, true)
    }
  }, [isOpen, measureAnchor])

  return useMemo(
    () => ({
      anchorRect,
      back,
      close,
      currentStep,
      finish,
      goTo,
      hasSeen,
      isFirstStep: stepIndex === 0,
      isLastStep: stepIndex === lastStepIndex,
      isOpen,
      next,
      open,
      skip,
      stepCount: steps.length,
      stepIndex,
    }),
    [
      anchorRect,
      back,
      close,
      currentStep,
      finish,
      goTo,
      hasSeen,
      isOpen,
      lastStepIndex,
      next,
      open,
      skip,
      stepIndex,
      steps.length,
    ],
  )
}
