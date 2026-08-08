import { useState } from 'react'
import { appName, tagline } from './appInfo'
import { Composer } from './composer/Composer'
import { AuthProvider } from './auth/AuthProvider'
import { AuthBar } from './auth/AuthBar'
import { ProfilePage } from './auth/ProfilePage'
import { useAuth } from './auth/authContext'
import { handleAuthChange, projectStore } from './appStores'
import './auth/auth.css'
import './App.css'

function AppShell() {
  const auth = useAuth()
  const [showProfile, setShowProfile] = useState(false)
  const onProfile = showProfile && auth.status === 'authenticated'

  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" />
          <h1>{appName}</h1>
        </div>
        <p className="tagline">{tagline}</p>
        <p className="hook">Every idea, resolved.</p>
        <AuthBar onShowProfile={() => setShowProfile(true)} profileActive={onProfile} />
      </header>

      {onProfile ? (
        <ProfilePage onClose={() => setShowProfile(false)} />
      ) : (
        <Composer options={{ store: projectStore }} />
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
