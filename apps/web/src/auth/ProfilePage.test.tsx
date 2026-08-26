import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { coversInteractions } from '../test/coversInteractions'
import { AuthError, type AuthClient, type Profile } from './authClient'
import { AuthContext, type AuthContextValue } from './authContext'
import { ProfilePage } from './ProfilePage'

const profile: Profile = {
  id: '1',
  displayName: 'Ada',
  bio: 'Composer',
  avatarUrl: null,
  tier: 'Free',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
}

function makeValue(client: Partial<AuthClient>): AuthContextValue {
  return {
    user: { id: '1', email: 'a@b.com', displayName: 'Ada', tier: 'Free' },
    offlineUser: null,
    status: 'authenticated',
    providers: [],
    error: null,
    client: client as unknown as AuthClient,
    register: vi.fn(async () => undefined),
    signIn: vi.fn(async () => undefined),
    requestMagicLink: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  }
}

const renderPage = (
  client: Partial<AuthClient>,
  onClose = vi.fn(),
  onUnauthorized = vi.fn(),
) =>
  render(
    <AuthContext value={makeValue(client)}>
      <ProfilePage onClose={onClose} onUnauthorized={onUnauthorized} />
    </AuthContext>,
  )

describe('ProfilePage', () => {
  it('loads and displays the profile with the read-only tier', async () => {
    renderPage({ getProfile: vi.fn(async () => profile) })

    expect(await screen.findByText(/Subscription tier:/)).toHaveTextContent('Free')
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada')
    expect(screen.getByLabelText('Bio')).toHaveValue('Composer')
    const avatar = screen.getByLabelText('Avatar URL')
    const hintId = avatar.getAttribute('aria-describedby')
    expect(hintId).toBeTruthy()
    expect(document.getElementById(hintId!)).toBeVisible()
    expect(document.getElementById(hintId!)).toHaveTextContent(
      'Use an HTTPS image URL.',
    )
  })

  it('shows an error when loading fails', async () => {
    renderPage({
      getProfile: vi.fn(async () => {
        throw new Error('nope')
      }),
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t load your profile/)
  })

  it('retries a server error without losing the route', async () => {
    coversInteractions('profile.retry')
    const getProfile = vi
      .fn()
      .mockRejectedValueOnce(new AuthError(500, 'Nope'))
      .mockResolvedValue(profile)
    renderPage({ getProfile })

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByLabelText('Display name')).toHaveValue('Ada')
    expect(getProfile).toHaveBeenCalledTimes(2)
  })

  it('re-enters the auth guard when the profile session expires', async () => {
    const onUnauthorized = vi.fn()
    renderPage(
      {
        getProfile: vi.fn(async () => {
          throw new AuthError(401, 'Unauthorized')
        }),
      },
      vi.fn(),
      onUnauthorized,
    )

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce())
    expect(screen.queryByText(/couldn’t load your profile/i)).not.toBeInTheDocument()
  })

  it('saves edits and refreshes the session', async () => {
    coversInteractions(
      'profile.display-name',
      'profile.bio',
      'profile.avatar-url',
      'profile.save',
    )
    const updateProfile = vi.fn(async () => ({ ...profile, displayName: 'Ada L.' }))
    const refresh = vi.fn(async () => undefined)
    const value = makeValue({ getProfile: vi.fn(async () => profile), updateProfile })
    value.refresh = refresh
    render(
      <AuthContext value={value}>
        <ProfilePage onClose={vi.fn()} onUnauthorized={vi.fn()} />
      </AuthContext>,
    )

    const name = await screen.findByLabelText('Display name')
    fireEvent.change(name, { target: { value: 'Ada L.' } })
    fireEvent.change(screen.getByLabelText('Bio'), {
      target: { value: 'Composer and arranger' },
    })
    fireEvent.change(screen.getByLabelText('Avatar URL'), {
      target: { value: 'https://example.test/ada.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith({
        displayName: 'Ada L.',
        bio: 'Composer and arranger',
        avatarUrl: 'https://example.test/ada.png',
      }),
    )
    expect(refresh).toHaveBeenCalled()
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('closes back to the composer', async () => {
    coversInteractions('profile.close')
    const onClose = vi.fn()
    renderPage({ getProfile: vi.fn(async () => profile) }, onClose)

    await screen.findByLabelText('Display name')
    fireEvent.click(screen.getByRole('button', { name: 'Back to composer' }))
    expect(onClose).toHaveBeenCalled()
  })
})
