/**
 * useEntitlements — resolves the signed-in user's server-authoritative
 * entitlements so the app can gate convenience behaviour (e.g. whether WAV
 * exports carry the free-tier watermark).
 *
 * Enforcement stays on the server; this hook only mirrors the entitlement set for
 * the UI. Anonymous users resolve to `null`, which callers treat as the safe
 * free-tier default.
 */
import { useEffect, useState } from 'react'
import { EntitlementsClient, type Entitlements } from './entitlementsClient'

/** A process-wide client so the reference is stable across renders. */
const sharedClient = new EntitlementsClient()

export function useEntitlements(
  authenticated: boolean,
  client: EntitlementsClient = sharedClient,
): Entitlements | null {
  const [fetched, setFetched] = useState<Entitlements | null>(null)

  useEffect(() => {
    if (!authenticated) {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const loaded = await client.getEntitlements()
        if (!cancelled) setFetched(loaded)
      } catch {
        // Fall back to the free-tier default on any failure.
        if (!cancelled) setFetched(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authenticated, client])

  // Derive the anonymous case so signing out reflects immediately without a
  // synchronous state reset inside the effect.
  return authenticated ? fetched : null
}
