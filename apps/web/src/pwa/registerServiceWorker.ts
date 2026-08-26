import type { PlatformCapabilitySource } from '../composer/contract/platform'
import { capabilitySourceFor } from '../platform/platformCapabilities'

export function registerServiceWorker(
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
  enabled: boolean = import.meta.env.PROD,
  platformCapabilities: PlatformCapabilitySource = capabilitySourceFor(
    typeof window === 'undefined' ? undefined : window,
    nav,
  ),
  basePath: string = import.meta.env.BASE_URL,
): void {
  if (
    !enabled ||
    !nav ||
    !('serviceWorker' in nav) ||
    !platformCapabilities.getSnapshot().hasServiceWorker ||
    typeof document === 'undefined' ||
    typeof window === 'undefined'
  ) {
    return
  }

  const register = () => {
    nav.serviceWorker
      .register(`${basePath}sw.js`, { scope: basePath })
      .catch(() => {})
  }

  if (document.readyState === 'complete') {
    register()
    return
  }

  window.addEventListener('load', register, { once: true })
}
