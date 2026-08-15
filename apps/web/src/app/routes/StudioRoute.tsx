import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useAuth } from '../../auth/authContext'
import { Composer } from '../../composer/Composer'
import { buildCollabConfig } from '../../composer/model/collab/collabConfig'
import { OnboardingTour } from '../../onboarding/OnboardingTour'
import { useProjectStore } from '../projectStoreContext'
import type { AppRouteContext } from '../routeContext'

export function StudioRoute() {
  const auth = useAuth()
  const store = useProjectStore()
  const location = useLocation()
  const navigate = useNavigate()
  const { authenticated, watermarkExports } = useOutletContext<AppRouteContext>()
  const collab = useMemo(
    () =>
      buildCollabConfig({
        search: location.search,
        location: window.location,
        user: auth.user,
        relayOverride: import.meta.env?.VITE_COLLAB_URL as string | undefined,
      }),
    [auth.user, location.search],
  )
  const consumeSharedProject = useCallback(() => {
    void navigate(
      { pathname: location.pathname, search: location.search, hash: '' },
      { replace: true },
    )
  }, [location.pathname, location.search, navigate])

  return (
    <>
      <Composer
        options={{
          store,
          watermarkExports,
          sharedProjectHash: location.hash,
          onSharedProjectConsumed: consumeSharedProject,
        }}
        collab={collab}
        canShare={authenticated}
        guardNavigation
      />
      <OnboardingTour />
    </>
  )
}
