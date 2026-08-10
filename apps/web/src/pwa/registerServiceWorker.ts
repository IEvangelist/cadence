export function registerServiceWorker(
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
  enabled: boolean = import.meta.env.PROD,
): void {
  if (!enabled || !nav || !('serviceWorker' in nav)) {
    return
  }

  const register = () => {
    nav.serviceWorker.register('/sw.js').catch(() => {})
  }

  if (document.readyState === 'complete') {
    register()
    return
  }

  window.addEventListener('load', register, { once: true })
}
