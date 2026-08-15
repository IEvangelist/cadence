import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { coversInteractions } from '../test/coversInteractions'
import { EntitlementsClient, type Entitlements } from './entitlementsClient'
import { PricingPage } from './PricingPage'

const freeEntitlements: Entitlements = {
  tier: 'Free',
  watermarkExports: true,
  maxProjects: 10,
  aiGenerationsPerDay: 50,
  advancedFormats: false,
  stemSeparation: false,
  collaborationSeats: 1,
}

const proEntitlements: Entitlements = {
  tier: 'Pro',
  watermarkExports: false,
  maxProjects: -1,
  aiGenerationsPerDay: -1,
  advancedFormats: true,
  stemSeparation: true,
  collaborationSeats: 5,
}

// Builds an EntitlementsClient whose methods are stubbed, so the page's behaviour
// is tested without touching the network.
function fakeClient(overrides: Partial<Record<keyof EntitlementsClient, unknown>> = {}) {
  const client = new EntitlementsClient(async () => new Response(null, { status: 500 }), '')
  return Object.assign(client, {
    getEntitlements: vi.fn(async () => freeEntitlements),
    startCheckout: vi.fn(async () => 'https://stripe.test/checkout'),
    openPortal: vi.fn(async () => 'https://stripe.test/portal'),
    ...overrides,
  }) as EntitlementsClient
}

describe('<PricingPage />', () => {
  it('shows both plans and reflects the free tier', async () => {
    const client = fakeClient()
    render(<PricingPage client={client} redirect={vi.fn()} />)

    expect(await screen.findByText(/You’re on the/)).toHaveTextContent('Free')
    expect(screen.getByRole('heading', { name: 'Free' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
  })

  it('starts checkout and redirects when upgrading', async () => {
    coversInteractions('pricing.upgrade')
    const redirect = vi.fn()
    const client = fakeClient()
    render(<PricingPage client={client} redirect={redirect} />)

    const upgrade = await screen.findByRole('button', { name: 'Upgrade to Pro' })
    fireEvent.click(upgrade)

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://stripe.test/checkout'))
    expect(client.startCheckout).toHaveBeenCalledOnce()
  })

  it('offers the customer portal to pro users', async () => {
    coversInteractions('pricing.manage')
    const redirect = vi.fn()
    const client = fakeClient({ getEntitlements: vi.fn(async () => proEntitlements) })
    render(<PricingPage client={client} redirect={redirect} />)

    const manage = await screen.findByRole('button', { name: 'Manage billing' })
    fireEvent.click(manage)

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('https://stripe.test/portal'))
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument()
  })

  it('surfaces a checkout failure without redirecting', async () => {
    const redirect = vi.fn()
    const client = fakeClient({
      startCheckout: vi.fn(async () => {
        throw new Error('nope')
      }),
    })
    render(<PricingPage client={client} redirect={redirect} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t start checkout/i)
    expect(redirect).not.toHaveBeenCalled()
  })

  it('still shows the plans when entitlements fail to load', async () => {
    const client = fakeClient({
      getEntitlements: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    render(<PricingPage client={client} redirect={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your plan/i)
    // Free is the default, so the upgrade CTA is still offered.
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument()
  })

  it('calls onClose from the back button', async () => {
    coversInteractions('pricing.close')
    const onClose = vi.fn()
    render(<PricingPage client={fakeClient()} redirect={vi.fn()} onClose={onClose} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Back to composer' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
