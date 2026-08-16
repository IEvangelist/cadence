import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import { StemsPage } from '../../stems/StemsPage'
import type { AppRouteContext } from '../routeContext'

export function StemsRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  const { authenticated, entitlements } = useOutletContext<AppRouteContext>()
  const go = (pathname: string) =>
    void navigate({ pathname, search: location.search, hash: location.hash })
  return (
    <StemsPage
      authenticated={authenticated}
      entitled={entitlements?.stemSeparation ?? false}
      onUpgrade={() => go('/pricing')}
      onClose={() => go('/')}
    />
  )
}
