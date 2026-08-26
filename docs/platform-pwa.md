# Platform capabilities and PWA

Cadence reads runtime platform facts through one observable
`PlatformCapabilitySource` (`apps/web/src/platform/platformCapabilities.ts`).
The source is safe to import during SSR, has a deterministic server snapshot,
and can be injected through `PlatformCapabilitiesProvider` or the optional
`AppProviders.platformCapabilities` property.

## Capability model

The snapshot exposes:

- `keyboardPlatform`: Mac-family command labels or the Ctrl/Alt labels used by
  other keyboard platforms. iPad desktop mode is handled through
  `navigator.platform` plus touch points; browser user-agent strings are not
  parsed.
- `coarsePointer` and `finePointer`: independent media-query results, allowing
  hybrid devices to report both.
- `viewport`: width, height, and the existing `mobile` (up to 40rem), `tablet`
  (up to 60rem), or `desktop` category.
- `isStandalone`: the `display-mode: standalone` result with the iOS
  `navigator.standalone` capability as a fallback.
- `isOnline`: the current navigator state, refreshed by `online` and `offline`
  events.
- `hasCacheStorage` and `hasServiceWorker`: API availability, not a promise
  that registration, storage, or network access will succeed.

The source also observes pointer, display-mode, viewport, resize, and
connectivity changes. When `matchMedia` or other browser APIs are missing,
values fall back conservatively without throwing. SSR reports a desktop,
non-installed, online baseline with browser-only APIs unavailable.

## Consumers and responsive behavior

Keybinding labels, service-worker registration, route-cache warming, and the
mobile Studio layout consume the shared source. Tests and embedded hosts can
inject a source instead of changing globals.

The capability layer does not replace CSS responsiveness. Existing media
queries remain authoritative for styling. The mobile Studio seam preserves its
prior `(max-width: 40rem), (pointer: coarse)` behavior by selecting mobile
layout for either a mobile viewport category or a coarse primary pointer.

## PWA behavior

Production startup registers `/sw.js` only when service workers are available.
Secondary routes are warmed after service-worker control where supported;
CacheStorage-backed readiness is reported only when that API exists and every
observed same-origin asset has been cached. Unsupported hosts still warm route
modules and leave cache readiness false. Registration and prefetch failures
remain non-fatal.
