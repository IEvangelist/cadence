import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './index.css'
import './theme/responsive.css'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
