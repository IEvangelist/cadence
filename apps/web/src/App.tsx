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
import { handleAuthChange, projectStore } from './appStores'
import { buildCollabConfig } from './composer/model/collab/collabConfig'
import './auth/auth.css'
import './App.css'

type View = 'composer' | 'profile' | 'pricing' | 'stems'

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

  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
          <h1>{appName}</h1>
        </div>
        <p className="tagline">{tagline}</p>
        <p className="hook">Every idea, resolved.</p>
        <AuthBar onShowProfile={() => setView('profile')} profileActive={showProfile} />
        <nav className="app-nav" aria-label="Primary">
          <button
            type="button"
            className="app-nav-link"
            onClick={() => setView(showStems ? 'composer' : 'stems')}
            aria-pressed={showStems}
          >
            {showStems ? 'Back to composer' : 'Stems'}
          </button>
          <button
            type="button"
            className="app-nav-link"
            onClick={() => setView(showPricing ? 'composer' : 'pricing')}
            aria-pressed={showPricing}
          >
            {showPricing ? 'Back to composer' : 'Pricing'}
          </button>
        </nav>
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
      ) : (
        <Composer
          options={{ store: projectStore, watermarkExports }}
          collab={collab}
          canShare={authenticated}
        />
      )}
    </main>
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
