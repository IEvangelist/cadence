import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../theme/fonts.css'
import '../../theme/tokens.css'
import '../../index.css'
import '../mobile.css'
import './mobileHarness.css'
import { MobileNotesHarness } from './MobileNotesHarness'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileNotesHarness />
  </StrictMode>,
)
