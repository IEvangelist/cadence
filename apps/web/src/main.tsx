import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './index.css'
import './theme/responsive.css'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import App from './App.tsx'
import { OnboardingTour } from './onboarding/OnboardingTour'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <OnboardingTour />
  </StrictMode>,
)

registerServiceWorker()
