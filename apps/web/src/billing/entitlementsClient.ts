/**
 * Thin, typed client for the Cadence billing + entitlement API.
 *
 * Mirrors the conventions of `auth/authClient.ts`: the fetch implementation and
 * base URL are injectable so the client is unit-testable without a live server,
 * and every call sends the auth cookie (`credentials: 'include'`). The server is
 * authoritative for entitlements — this client only reads them and kicks off the
 * hosted Stripe Checkout / Customer Portal flows.
 */
import { CsrfClient, type FetchLike } from '../api/csrfClient'
import {
  captureAuthMutation,
  type AuthMutationContextFactory,
} from '../auth/authMutationCoordinator'

/** The caller's current tier and the typed entitlements it grants. */
export interface Entitlements {
  tier: string
  watermarkExports: boolean
  maxProjects: number
  aiGenerationsPerDay: number
  advancedFormats: boolean
  stemSeparation: boolean
  collaborationSeats: number
}

/** A billing API call failed with a non-success status. */
export class BillingError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'BillingError'
    this.status = status
  }
}

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined
  return (configured ?? '').replace(/\/+$/, '')
}

/** Client for `/api/entitlements` and `/api/billing/*`. */
export class EntitlementsClient {
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly csrf: CsrfClient
  private readonly mutationContext?: AuthMutationContextFactory

  constructor(
    fetchImpl?: FetchLike,
    baseUrl?: string,
    mutationContext?: AuthMutationContextFactory,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.baseUrl = baseUrl ?? defaultBaseUrl()
    this.csrf = new CsrfClient(this.fetchImpl, this.baseUrl)
    this.mutationContext =
      mutationContext ?? (fetchImpl === undefined ? captureAuthMutation : undefined)
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  /** The caller's current entitlements (401 when signed out). */
  async getEntitlements(): Promise<Entitlements> {
    const response = await this.fetchImpl(this.url('/api/entitlements'), {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new BillingError(response.status, 'Could not load your plan.')
    }
    return (await response.json()) as Entitlements
  }

  /**
   * Start a hosted Stripe Checkout session and return its URL. The caller
   * redirects the browser there to complete the upgrade.
   */
  async startCheckout(): Promise<string> {
    return this.billingUrl('/api/billing/checkout', 'We couldn’t start checkout. Please try again.')
  }

  /**
   * Open the Stripe Customer Portal (manage/cancel) and return its URL. Paid-only:
   * a free user without a billing relationship gets a 402.
   */
  async openPortal(): Promise<string> {
    return this.billingUrl('/api/billing/portal', 'The billing portal isn’t available yet.')
  }

  private async billingUrl(path: string, fallback: string): Promise<string> {
    const response = await this.csrf.mutation(path, {
      method: 'POST',
    }, this.mutationContext?.())
    if (!response.ok) {
      throw new BillingError(response.status, fallback)
    }
    const body = (await response.json()) as { url: string }
    return body.url
  }
}
