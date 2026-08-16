import type { Entitlements } from '../billing/entitlementsClient'

export interface AppRouteContext {
  authenticated: boolean
  signingOut: boolean
  entitlements: Entitlements | null
  watermarkExports: boolean
}
