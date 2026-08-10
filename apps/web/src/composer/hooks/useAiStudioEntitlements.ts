/**
 * useAiStudioEntitlements — resolve the AI Studio's tier gating from context.
 *
 * The composer is rendered in tests *without* an `AuthProvider`, so this hook
 * reads {@link AuthContext} directly with `useContext` (which returns `null` when
 * no provider is present) rather than `useAuth` (which throws). That lets the AI
 * Studio resolve real entitlements inside the app while safely falling back to the
 * free tier in tests and anonymous sessions — with zero edits to the hot
 * `App.tsx`/`useComposer` files.
 */
import { useContext } from 'react'
import { AuthContext } from '../../auth/authContext'
import { useEntitlements } from '../../billing/useEntitlements'
import type { Entitlements } from '../../billing/entitlementsClient'

export function useAiStudioEntitlements(): Entitlements | null {
  const auth = useContext(AuthContext)
  const authenticated = auth?.status === 'authenticated'
  return useEntitlements(authenticated)
}
