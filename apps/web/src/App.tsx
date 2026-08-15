import { useMemo, useState } from 'react'
import { appName, tagline } from './appInfo'
import { Composer } from './composer/Composer'
import { AuthProvider } from './auth/AuthProvider'
import { AuthBar } from './auth/AuthBar'
import { ProfilePage } from './auth/ProfilePage'
import { useAuth } from './auth/authContext'
import { PricingPage } from './billing/PricingPage'
import { useEntitlements } from './billing/useEntitlements'
import { watermarkExportsFor } from './composer/formats/exportEntitlements'
import { StemsPage } from './stems/StemsPage'
import { AcknowledgementsPage } from './acknowledgements/AcknowledgementsPage'
import { handleAuthChange, projectStore } from './appStores'
import { buildCollabConfig } from './composer/model/collab/collabConfig'
import './auth/auth.css'
import './App.css'

type View = 'composer' | 'profile' | 'pricing' | 'stems' | 'acknowledgements'

function AppShell() {
  const auth = useAuth()
  const [view, setView] = useState<View>('composer')
  const authenticated = auth.status === 'authenticated'
  const entitlements = useEntitlements(authenticated)

  // Server-authoritative; the client gate is convenience only. Routed through the
  // published export seam, which defaults unknown/anonymous/malformed entitlements
  // to watermarked (the safe free-tier default).
  const watermarkExports = watermarkExportsFor(entitlements)

  // Opt-in live collaboration parsed from the share link + signed-in identity.
  // Null (the common case) keeps the composer single-user.
  const collab = useMemo(
    () =>
      buildCollabConfig({
        search: window.location.search,
        location: window.location,
        user: auth.user,
        relayOverride: import.meta.env?.VITE_COLLAB_URL as string | undefined,
      }),
    [auth.user],
  )

  const showProfile = view === 'profile' && authenticated
  const showPricing = view === 'pricing'
  const showStems = view === 'stems'
  const showAcknowledgements = view === 'acknowledgements'
  const showComposer = !showPricing && !showStems && !showProfile && !showAcknowledgements

  return (
    <>
      <main className={`app${showComposer ? ' app--composer' : ''}`}>
        {showComposer && (
          <a className="skip-link" href="#composer-main" data-interaction="app.skip-to-composer">
            Skip to editor
          </a>
        )}
        <header className="app-header">
          <div className="app-header__brand">
            <div className="brand">
              <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
              <h1>{appName}</h1>
            </div>
            <p className="tagline">{tagline}</p>
          </div>
          <div className="app-header__actions">
            <AuthBar onShowProfile={() => setView('profile')} profileActive={showProfile} />
            <nav className="app-nav" aria-label="Primary">
              <button
                type="button"
                className="app-nav-link"
                data-interaction="app.nav.stems"
                onClick={() => setView(showStems ? 'composer' : 'stems')}
                aria-pressed={showStems}
              >
                {showStems ? 'Back to composer' : 'Stems'}
              </button>
              <button
                type="button"
                className="app-nav-link"
                data-interaction="app.nav.pricing"
                onClick={() => setView(showPricing ? 'composer' : 'pricing')}
                aria-pressed={showPricing}
              >
                {showPricing ? 'Back to composer' : 'Pricing'}
              </button>
            </nav>
          </div>
        </header>

        {showPricing ? (
          <PricingPage onClose={() => setView('composer')} />
        ) : showStems ? (
          <StemsPage
            authenticated={authenticated}
            entitled={entitlements?.stemSeparation ?? false}
            onUpgrade={() => setView('pricing')}
            onClose={() => setView('composer')}
          />
        ) : showProfile ? (
          <ProfilePage onClose={() => setView('composer')} />
        ) : showAcknowledgements ? (
          <AcknowledgementsPage onClose={() => setView('composer')} />
        ) : (
          <Composer
            options={{ store: projectStore, watermarkExports }}
            collab={collab}
            canShare={authenticated}
          />
        )}
      </main>

      <footer className="app-footer">
        <p className="app-footer__note">Cadence is open-source software.</p>
        <nav className="app-footer__nav" aria-label="About Cadence">
          <button
            type="button"
            className="app-footer__link"
            data-interaction="app.nav.licenses"
            onClick={() => setView(showAcknowledgements ? 'composer' : 'acknowledgements')}
            aria-pressed={showAcknowledgements}
          >
            Third-party licenses
          </button>
        </nav>
      </footer>
    </>
  )
}

function App() {
  return (
    <AuthProvider onAuthChange={handleAuthChange}>
      <AppShell />
    </AuthProvider>
  )
}

export default App
