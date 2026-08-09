import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { EntitlementsClient, type Entitlements } from './entitlementsClient'
import { useEntitlements } from './useEntitlements'

const proEntitlements: Entitlements = {
  tier: 'Pro',
  watermarkExports: false,
  maxProjects: -1,
  aiGenerationsPerDay: -1,
  advancedFormats: true,
  stemSeparation: true,
  collaborationSeats: 5,
}

function clientReturning(value: Entitlements | Error): EntitlementsClient {
  const client = new EntitlementsClient(async () => new Response(null, { status: 500 }), '')
  client.getEntitlements = vi.fn(async () => {
    if (value instanceof Error) throw value
    return value
  })
  return client
}

describe('useEntitlements', () => {
  it('stays null while anonymous and never calls the API', () => {
    const client = clientReturning(proEntitlements)
    const { result } = renderHook(() => useEntitlements(false, client))

    expect(result.current).toBeNull()
    expect(client.getEntitlements).not.toHaveBeenCalled()
  })

  it('loads entitlements once authenticated', async () => {
    const client = clientReturning(proEntitlements)
    const { result } = renderHook(() => useEntitlements(true, client))

    await waitFor(() => expect(result.current).toEqual(proEntitlements))
  })

  it('falls back to null when the API fails', async () => {
    const client = clientReturning(new Error('offline'))
    const { result } = renderHook(() => useEntitlements(true, client))

    await waitFor(() => expect(client.getEntitlements).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })
})
