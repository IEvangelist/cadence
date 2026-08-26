import type { ReactNode } from 'react'
import { AuthDialogProvider } from '../auth/AuthDialog'
import { AuthProvider } from '../auth/AuthProvider'
import type { ProjectStore } from '../composer/model/storage'
import { handleAuthChange, projectStore } from '../appStores'
import { ThemeProvider } from '../theme/ThemeProvider'
import { ProjectStoreContext } from './projectStoreContext'
import type { PlatformCapabilitySource } from '../composer/contract/platform'
import { PlatformCapabilitiesProvider } from '../platform/PlatformCapabilitiesProvider'

interface AppProvidersProps {
  children: ReactNode
  store?: ProjectStore
  platformCapabilities?: PlatformCapabilitySource
}

export function AppProviders({
  children,
  store = projectStore,
  platformCapabilities,
}: AppProvidersProps) {
  return (
    <PlatformCapabilitiesProvider source={platformCapabilities}>
      <ThemeProvider>
        <AuthProvider onAuthChange={handleAuthChange}>
          <AuthDialogProvider>
            <ProjectStoreContext value={store}>{children}</ProjectStoreContext>
          </AuthDialogProvider>
        </AuthProvider>
      </ThemeProvider>
    </PlatformCapabilitiesProvider>
  )
}
