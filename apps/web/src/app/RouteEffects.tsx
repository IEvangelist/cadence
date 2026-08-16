import { type RefObject, useEffect, useRef } from 'react'
import { useLocation, useMatches } from 'react-router-dom'

interface RouteHandle {
  title?: string
  announcement?: string
}

interface RouteEffectsProps {
  mainRef: RefObject<HTMLElement | null>
}

export function RouteEffects({ mainRef }: RouteEffectsProps) {
  const location = useLocation()
  const matches = useMatches()
  const previousPath = useRef(location.pathname)
  const handle = [...matches]
    .reverse()
    .map((match) => match.handle as RouteHandle | undefined)
    .find((candidate) => candidate?.title)
  const title = handle?.title ?? 'Cadence'
  const announcement = handle?.announcement ?? title.replace(' | Cadence', '')

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    if (previousPath.current === location.pathname) return
    previousPath.current = location.pathname
    const routeHeading = mainRef.current?.querySelector<HTMLElement>('[data-route-heading]')
    ;(routeHeading ?? mainRef.current)?.focus()
  }, [location.pathname, mainRef])

  return (
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  )
}
