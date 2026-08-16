/**
 * ProfilePage — a basic, accessible view/edit surface for the signed-in user's
 * profile. It loads the profile on mount, shows the read-only subscription tier
 * (from the entitlement seam), and lets the user edit their display name, bio,
 * and avatar URL.
 */
import { useEffect, useId, useState } from 'react'
import { FormField } from '../ui/FormField'
import { RoutedPage, RouteState } from '../ui/RoutedPage'
import { AuthError, type Profile } from './authClient'
import { useAuth } from './authContext'

interface ProfilePageProps {
  /** Close the profile view and return to the composer. */
  onClose: () => void
  /** Re-enter the route guard when the profile endpoint reports an expired session. */
  onUnauthorized: () => void
}

export function ProfilePage({ onClose, onUnauthorized }: ProfilePageProps) {
  const auth = useAuth()
  const fieldId = useId()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await auth.client.getProfile()
        if (cancelled) return
        setProfile(loaded)
        setDisplayName(loaded.displayName)
        setBio(loaded.bio ?? '')
        setAvatarUrl(loaded.avatarUrl ?? '')
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        if (error instanceof AuthError && error.status === 401) {
          onUnauthorized()
          return
        }
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auth.client, loadAttempt, onUnauthorized])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setSaved(false)
    setSaveError(null)
    try {
      const updated = await auth.client.updateProfile({
        displayName,
        bio,
        avatarUrl,
      })
      setProfile(updated)
      setSaved(true)
      await auth.refresh()
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        onUnauthorized()
      } else {
        setSaveError('We couldn’t save your profile. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <RoutedPage
      title="Your profile"
      description="Manage the public details attached to your Cadence account."
      width="content"
      className="profile"
      actions={
        <button
          type="button"
          className="btn"
          data-interaction="profile.close"
          onClick={onClose}
        >
          Back to composer
        </button>
      }
    >

      {status === 'loading' && <RouteState kind="loading" label="Loading your profile" />}
      {status === 'error' && (
        <RouteState
          kind="error"
          label="Your profile could not be loaded"
          title="Your profile is unavailable"
          message="We couldn’t load your profile. Your account details have not been changed."
          action={
            <button
              type="button"
              className="btn"
              data-interaction="profile.retry"
              onClick={() => {
                setStatus('loading')
                setLoadAttempt((attempt) => attempt + 1)
              }}
            >
              Retry
            </button>
          }
        />
      )}

      {status === 'ready' && profile && (
        <form className="auth-form" onSubmit={save}>
          <p className="profile-tier">
            Subscription tier: <strong>{profile.tier}</strong>
          </p>

          <FormField label="Display name" htmlFor={`${fieldId}-name`}>
            <input
              id={`${fieldId}-name`}
              type="text"
              data-interaction="profile.display-name"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value)
                setSaved(false)
              }}
            />
          </FormField>

          <FormField label="Bio" htmlFor={`${fieldId}-bio`}>
            <textarea
              id={`${fieldId}-bio`}
              rows={3}
              data-interaction="profile.bio"
              value={bio}
              onChange={(event) => {
                setBio(event.target.value)
                setSaved(false)
              }}
            />
          </FormField>

          <FormField
            label="Avatar URL"
            htmlFor={`${fieldId}-avatar`}
            hint="Use an HTTPS image URL."
          >
            <input
              id={`${fieldId}-avatar`}
              type="url"
              data-interaction="profile.avatar-url"
              value={avatarUrl}
              onChange={(event) => {
                setAvatarUrl(event.target.value)
                setSaved(false)
              }}
            />
          </FormField>

          <button
            type="submit"
            className="btn btn-primary"
            data-interaction="profile.save"
            disabled={busy}
          >
            Save changes
          </button>

          {saved && (
            <RouteState kind="success" label="Profile saved" message="Profile saved." />
          )}
          {saveError ? (
            <RouteState kind="error" label={saveError} message={saveError} />
          ) : null}
        </form>
      )}
    </RoutedPage>
  )
}
