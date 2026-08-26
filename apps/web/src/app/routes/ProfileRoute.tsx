import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { useAuthDialog } from '../../auth/authDialogContext'
import { ProfilePage } from '../../auth/ProfilePage'
import { routeLocationToString } from '../../auth/authReturnTarget'
import { useAuth } from '../../auth/authContext'
import { RoutedPage, RoutedPageSkeleton, RouteState } from '../../ui/RoutedPage'
import type { AppRouteContext } from '../routeContext'
import { backendConfig } from '../../platform/backendConfig'

export function ProfileRoute() {
  const auth = useAuth()
  const refreshAuth = auth.refresh
  const { openAuth } = useAuthDialog()
  const navigate = useNavigate()
  const location = useLocation()
  const { signingOut } = useOutletContext<AppRouteContext>()

  const returnTarget = routeLocationToString(location)
  const dismissTo = routeLocationToString({
    pathname: '/',
    search: location.search,
    hash: location.hash,
  })

  useEffect(() => {
    if (!backendConfig.available) return
    if (auth.status !== 'anonymous' || signingOut) return
    openAuth({ returnTarget, dismissTo })
  }, [auth.status, dismissTo, openAuth, returnTarget, signingOut])

  const handleUnauthorized = useCallback(() => {
    void refreshAuth()
  }, [refreshAuth])

  if (!backendConfig.available) {
    return (
      <RoutedPage
        title="Accounts unavailable"
        description="This static Cadence app keeps projects in this browser."
        width="content"
        actions={
          <button
            type="button"
            className="btn"
            data-interaction="profile.close"
            onClick={() => void navigate(dismissTo, { replace: true })}
          >
            Back to composer
          </button>
        }
      >
        <RouteState
          kind="info"
          label="Local-only mode"
          message="Sign-in, profiles, and cloud project sync require a configured Cadence backend."
        />
      </RoutedPage>
    )
  }

  if (auth.status !== 'authenticated') {
    return <RoutedPageSkeleton label="Loading your profile" width="content" />
  }

  return (
    <ProfilePage
      onUnauthorized={handleUnauthorized}
      onClose={() =>
        void navigate({ pathname: '/', search: location.search, hash: location.hash })
      }
    />
  )
}
