import type { Entitlements } from '../billing/entitlementsClient'

export interface AppRouteContext {
  authenticated: boolean
  entitlements: Entitlements | null
  watermarkExports: boolean
}
