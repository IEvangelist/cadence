import type { ReactNode } from 'react'
import { AuthDialogProvider } from '../auth/AuthDialog'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthClient } from '../auth/authClient'
import type { OfflineIdentityStore } from '../auth/offlineIdentity'
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
  authClient?: AuthClient
  offlineIdentityStore?: OfflineIdentityStore
}

export function AppProviders({
  children,
  store = projectStore,
  platformCapabilities,
  authClient,
  offlineIdentityStore,
}: AppProvidersProps) {
  return (
    <PlatformCapabilitiesProvider source={platformCapabilities}>
      <ThemeProvider>
        <AuthProvider
          client={authClient}
          offlineIdentityStore={offlineIdentityStore}
          onAuthChange={handleAuthChange}
        >
          <AuthDialogProvider>
            <ProjectStoreContext value={store}>{children}</ProjectStoreContext>
          </AuthDialogProvider>
        </AuthProvider>
      </ThemeProvider>
    </PlatformCapabilitiesProvider>
  )
}
