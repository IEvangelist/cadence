import { createContext, useContext, useSyncExternalStore } from 'react'
import type {
  PlatformCapabilities,
  PlatformCapabilitySource,
} from '../composer/contract/platform'
import { browserPlatformCapabilitySource } from './platformCapabilities'

export const PlatformCapabilityContext = createContext<PlatformCapabilitySource>(
  browserPlatformCapabilitySource,
)

export function usePlatformCapabilitySource(): PlatformCapabilitySource {
  return useContext(PlatformCapabilityContext)
}

export function usePlatformCapabilities(): PlatformCapabilities {
  const source = usePlatformCapabilitySource()
  return useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
    source.getServerSnapshot,
  )
}
