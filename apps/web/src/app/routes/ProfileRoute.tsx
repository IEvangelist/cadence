import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuthDialog } from '../../auth/authDialogContext'
import { ProfilePage } from '../../auth/ProfilePage'
import { routeLocationToString } from '../../auth/authReturnTarget'
import { useAuth } from '../../auth/authContext'
import { RoutedPageSkeleton } from '../../ui/RoutedPage'

export function ProfileRoute() {
  const auth = useAuth()
  const refreshAuth = auth.refresh
  const { openAuth } = useAuthDialog()
  const navigate = useNavigate()
  const location = useLocation()

  const returnTarget = routeLocationToString(location)
  const dismissTo = routeLocationToString({
    pathname: '/',
    search: location.search,
    hash: location.hash,
  })

  useEffect(() => {
    if (auth.status !== 'anonymous') return
    openAuth({ returnTarget, dismissTo })
  }, [auth.status, dismissTo, openAuth, returnTarget])

  const handleUnauthorized = useCallback(() => {
    void refreshAuth()
  }, [refreshAuth])

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
