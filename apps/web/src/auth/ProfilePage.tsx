/**
 * ProfilePage — a basic, accessible view/edit surface for the signed-in user's
 * profile. It loads the profile on mount, shows the read-only subscription tier
 * (from the entitlement seam), and lets the user edit their display name, bio,
 * and avatar URL.
 */
import { useEffect, useId, useState } from 'react'
import { type Profile } from './authClient'
import { useAuth } from './authContext'

interface ProfilePageProps {
  /** Close the profile view and return to the composer. */
  onClose: () => void
}

export function ProfilePage({ onClose }: ProfilePageProps) {
  const auth = useAuth()
  const fieldId = useId()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

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
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [auth.client])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setSaved(false)
    try {
      const updated = await auth.client.updateProfile({
        displayName,
        bio,
        avatarUrl,
      })
      setProfile(updated)
      setSaved(true)
      await auth.refresh()
    } catch {
      setStatus('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="profile" aria-labelledby={`${fieldId}-title`}>
      <div className="profile-head">
        <h2 id={`${fieldId}-title`}>Your profile</h2>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Back to composer
        </button>
      </div>

      {status === 'loading' && <p role="status">Loading your profile…</p>}
      {status === 'error' && (
        <p className="auth-error" role="alert">
          We couldn’t load your profile. Please try again.
        </p>
      )}

      {status === 'ready' && profile && (
        <form className="auth-form" onSubmit={save}>
          <p className="profile-tier">
            Subscription tier: <strong>{profile.tier}</strong>
          </p>

          <div className="auth-field">
            <label htmlFor={`${fieldId}-name`}>Display name</label>
            <input
              id={`${fieldId}-name`}
              type="text"
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value)
                setSaved(false)
              }}
            />
          </div>

          <div className="auth-field">
            <label htmlFor={`${fieldId}-bio`}>Bio</label>
            <textarea
              id={`${fieldId}-bio`}
              rows={3}
              value={bio}
              onChange={(event) => {
                setBio(event.target.value)
                setSaved(false)
              }}
            />
          </div>

          <div className="auth-field">
            <label htmlFor={`${fieldId}-avatar`}>Avatar URL</label>
            <input
              id={`${fieldId}-avatar`}
              type="url"
              value={avatarUrl}
              onChange={(event) => {
                setAvatarUrl(event.target.value)
                setSaved(false)
              }}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save changes
          </button>

          {saved && (
            <p className="auth-note" role="status">
              Profile saved.
            </p>
          )}
        </form>
      )}
    </section>
  )
}
