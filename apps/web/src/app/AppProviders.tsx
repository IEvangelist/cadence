import type { ReactNode } from 'react'
import { AuthProvider } from '../auth/AuthProvider'
import type { ProjectStore } from '../composer/model/storage'
import { handleAuthChange, projectStore } from '../appStores'
import { ThemeProvider } from '../theme/ThemeProvider'
import { ProjectStoreContext } from './projectStoreContext'

interface AppProvidersProps {
  children: ReactNode
  store?: ProjectStore
}

export function AppProviders({ children, store = projectStore }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <AuthProvider onAuthChange={handleAuthChange}>
        <ProjectStoreContext value={store}>{children}</ProjectStoreContext>
      </AuthProvider>
    </ThemeProvider>
  )
}
