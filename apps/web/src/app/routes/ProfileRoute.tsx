import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { ProfilePage } from '../../auth/ProfilePage'
import type { AppRouteContext } from '../routeContext'

export function ProfileRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authenticated } = useOutletContext<AppRouteContext>()
  if (!authenticated) {
    return (
      <section className="profile" aria-labelledby="profile-sign-in-title">
        <h2 id="profile-sign-in-title">Sign in to view your profile</h2>
        <p>Your Cadence profile is available after you sign in.</p>
      </section>
    )
  }
  return (
    <ProfilePage
      onClose={() =>
        void navigate({ pathname: '/', search: location.search, hash: location.hash })
      }
    />
  )
}
