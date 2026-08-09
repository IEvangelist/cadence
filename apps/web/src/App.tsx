import { useState } from 'react'
import { appName, tagline } from './appInfo'
import { Composer } from './composer/Composer'
import { AuthProvider } from './auth/AuthProvider'
import { AuthBar } from './auth/AuthBar'
import { ProfilePage } from './auth/ProfilePage'
import { useAuth } from './auth/authContext'
import { PricingPage } from './billing/PricingPage'
import { useEntitlements } from './billing/useEntitlements'
import { StemsPage } from './stems/StemsPage'
import { handleAuthChange, projectStore } from './appStores'
import './auth/auth.css'
import './App.css'

type View = 'composer' | 'profile' | 'pricing' | 'stems'

function AppShell() {
  const auth = useAuth()
  const [view, setView] = useState<View>('composer')
  const authenticated = auth.status === 'authenticated'
  const entitlements = useEntitlements(authenticated)

  // Server-authoritative; the client gate is convenience only. Unknown/anonymous
  // defaults to watermarked (the safe free-tier default).
  const watermarkExports = entitlements?.watermarkExports ?? true

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
        <Composer options={{ store: projectStore, watermarkExports }} />
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
