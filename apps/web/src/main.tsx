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

applyThemePreference(readThemePreference(browserThemeStorage()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
