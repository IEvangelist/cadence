import { useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { appName, tagline } from '../appInfo'
import { AuthBar } from '../auth/AuthBar'
import { useAuthDialog } from '../auth/authDialogContext'
import { useAuth } from '../auth/authContext'
import { useEntitlements } from '../billing/useEntitlements'
import { watermarkExportsFor } from '../composer/formats/exportEntitlements'
import { ThemeMenu } from '../theme/ThemeMenu'
import type { AppRouteContext } from './routeContext'
import { RouteEffects } from './RouteEffects'
import { AuthCallbackEffect } from './AuthCallbackEffect'
import { clearAuthReturnTarget } from '../auth/authReturnTarget'

function destination(pathname: string, location: ReturnType<typeof useLocation>) {
  return { pathname, search: location.search, hash: location.hash }
}

export function AppFrame() {
  const auth = useAuth()
  const authDialog = useAuthDialog()
  const location = useLocation()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [signingOut, setSigningOut] = useState(false)
  const authenticated = auth.status === 'authenticated'
  const entitlements = useEntitlements(authenticated)
  const studio = location.pathname === '/'
  const routeContext: AppRouteContext = {
    authenticated,
    signingOut,
    entitlements,
    watermarkExports: watermarkExportsFor(entitlements),
  }

  return (
    <>
      <main
        ref={mainRef}
        className={`app${studio ? ' app--composer' : ''}`}
        tabIndex={-1}
      >
        <RouteEffects mainRef={mainRef} />
        <AuthCallbackEffect />
        {studio ? (
          <a
            className="skip-link"
            href="#composer-main"
            data-interaction="app.skip-to-composer"
          >
            Skip to editor
          </a>
        ) : null}
        {!studio ? <header className="app-header">
          <div className="app-header__brand">
            <div className="brand">
              <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
              <h1>{appName}</h1>
            </div>
            <p className="tagline">{tagline}</p>
          </div>
          <div className="app-header__actions">
            <AuthBar
              onShowSignIn={() => authDialog.openAuth()}
              onShowProfile={() => void navigate(destination('/profile', location))}
              profileActive={location.pathname === '/profile'}
              signingOut={signingOut}
              onSignOut={async () => {
                setSigningOut(true)
                try {
                  await auth.signOut()
                } catch (error) {
                  console.warn('The server sign-out request failed after local sign-out.', error)
                } finally {
                  clearAuthReturnTarget()
                  if (location.pathname === '/profile') {
                    authDialog.closeAuth()
                    void navigate(destination('/', location), { replace: true })
                  }
                  setSigningOut(false)
                }
              }}
            />
            <nav className="app-nav" aria-label="Primary">
              <button
                type="button"
                className="app-nav-link"
                data-interaction="app.nav.stems"
                onClick={() => void navigate(destination('/stems', location))}
                aria-current={location.pathname === '/stems' ? 'page' : undefined}
              >
                Stems
              </button>
              <button
                type="button"
                className="app-nav-link"
                data-interaction="app.nav.pricing"
                onClick={() => void navigate(destination('/pricing', location))}
                aria-current={location.pathname === '/pricing' ? 'page' : undefined}
              >
                Pricing
              </button>
            </nav>
            <ThemeMenu />
          </div>
        </header> : null}

        <Outlet context={routeContext} />
      </main>

      {!studio ? <footer className="app-footer">
        <p className="app-footer__note">Cadence is open-source software.</p>
        <nav className="app-footer__nav" aria-label="About Cadence">
          <button
            type="button"
            className="app-footer__link"
            data-interaction="app.nav.licenses"
            onClick={() => void navigate(destination('/licenses', location))}
            aria-current={location.pathname === '/licenses' ? 'page' : undefined}
          >
            Third-party licenses
          </button>
        </nav>
      </footer> : null}
    </>
  )
}
