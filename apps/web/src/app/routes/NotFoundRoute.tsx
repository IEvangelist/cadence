import { useLocation, useNavigate } from 'react-router-dom'

export function NotFoundRoute() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <section className="route-page" aria-labelledby="not-found-title">
      <h2 id="not-found-title">Page not found</h2>
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
    </section>
  )
}
