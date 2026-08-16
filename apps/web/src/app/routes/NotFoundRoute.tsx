import { useLocation, useNavigate } from 'react-router-dom'
import { RoutedPage } from '../../ui/RoutedPage'

export function NotFoundRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <RoutedPage
      title="Page not found"
      description="That Cadence page does not exist."
      width="content"
    >
      <button
        type="button"
        className="btn btn-primary"
        data-interaction="app.not-found.studio"
        onClick={() =>
          void navigate(
            { pathname: '/', search: location.search, hash: location.hash },
            { replace: true },
          )
        }
      >
        Return to Studio
      </button>
    </RoutedPage>
  )
}
