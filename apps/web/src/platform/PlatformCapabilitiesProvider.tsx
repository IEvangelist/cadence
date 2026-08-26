import type { ReactNode } from 'react'
import type { PlatformCapabilitySource } from '../composer/contract/platform'
import { browserPlatformCapabilitySource } from './platformCapabilities'
import { PlatformCapabilityContext } from './platformCapabilitiesContext'

export function PlatformCapabilitiesProvider({
  children,
  source = browserPlatformCapabilitySource,
}: {
  children: ReactNode
  source?: PlatformCapabilitySource
}) {
  return (
    <PlatformCapabilityContext value={source}>
      {children}
    </PlatformCapabilityContext>
  )
}
