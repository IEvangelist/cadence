import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/fonts.css'
import './theme/tokens.css'
import './index.css'
import './theme/controls.css'
import './theme/responsive.css'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import App from './App.tsx'
import {
  applyThemePreference,
  browserThemeStorage,
  readThemePreference,
} from './theme/themeStorage'
import { prefetchSecondaryRoutes } from './app/routePrefetch'

applyThemePreference(readThemePreference(browserThemeStorage()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
void prefetchSecondaryRoutes().catch(() => {
  // Route navigation remains network-first when background warming is unavailable.
})
