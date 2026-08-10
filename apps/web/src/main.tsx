import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import './index.css'
import App from './App.tsx'
import { OnboardingTour } from './onboarding/OnboardingTour'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <OnboardingTour />
  </StrictMode>,
)
