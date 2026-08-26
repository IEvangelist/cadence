import { usePlatformCapabilities } from '../platform/platformCapabilitiesContext'

export function useMobileStudioLayout(): boolean {
  const capabilities = usePlatformCapabilities()
  return (
    capabilities.viewport.kind === 'mobile' || capabilities.coarsePointer
  )
}
