import { animate, inView } from 'motion'
import { useReducedMotion } from 'motion/react'
import { useEffect } from 'react'

const easing = [0.16, 1, 0.3, 1] as const

export default function LandingMotion() {
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const root = document.documentElement
    const heroElements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-hero-reveal]'),
    )
    const revealElements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-reveal]'),
    )

    root.dataset.motion = reduceMotion ? 'reduced' : 'full'

    if (reduceMotion) {
      for (const element of [...heroElements, ...revealElements]) {
        element.style.opacity = '1'
        element.style.transform = 'none'
      }
      return () => {
        delete root.dataset.motion
      }
    }

    const animations = heroElements.map((element, index) => {
      element.style.opacity = '0'
      element.style.transform = 'translateY(18px)'
      return animate(
        element,
        { opacity: 1, transform: 'translateY(0px)' },
        { duration: 0.7, delay: index * 0.09, ease: easing },
      )
    })

    const observers = revealElements.map((element) => {
      element.style.opacity = '0'
      element.style.transform = 'translateY(24px)'
      return inView(
        element,
        () => {
          const animation = animate(
            element,
            { opacity: 1, transform: 'translateY(0px)' },
            { duration: 0.72, ease: easing },
          )
          return () => animation.stop()
        },
        { amount: 0.18 },
      )
    })

    return () => {
      animations.forEach((animation) => animation.stop())
      observers.forEach((stop) => stop())
      delete root.dataset.motion
    }
  }, [reduceMotion])

  return null
}
