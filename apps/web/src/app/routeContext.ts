import type { Entitlements } from '../billing/entitlementsClient'

export interface AppRouteContext {
  backendAvailable: boolean
  authenticated: boolean
  signingOut: boolean
  openSignIn: () => void
  signOut: () => Promise<void>
  entitlements: Entitlements | null
  watermarkExports: boolean
}
