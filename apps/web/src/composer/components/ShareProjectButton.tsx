import { useEffect, useId, useState } from 'react'
import { CollabShareClient, shareLinkUrl, type ShareLink } from '../model/collab/collabClient'
import type { CollaborationRole } from '../model/collab/useCollaboration'

interface ShareProjectButtonProps {
  projectId: string
  /** Injectable API client (tests/e2e). */
  client?: CollabShareClient
  /** Origin used to format joinable links. Defaults to the page origin. */
  origin?: string
  /** Injectable clipboard writer (tests). */
  clipboard?: (text: string) => Promise<void>
}

const ROLE_LABEL: Record<Exclude<CollaborationRole, 'owner'>, string> = {
  editor: 'Editor',
  viewer: 'Viewer',
}

/**
 * Owner-facing affordance to mint and revoke collaboration share links. The
 * server authorizes every request (only a project's owner may manage its
 * shares) and issues the role — this UI never fabricates permissions.
 */
export function ShareProjectButton({
  projectId,
  client,
  origin,
  clipboard,
}: ShareProjectButtonProps) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<ShareLink[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const panelId = useId()

  const api = client ?? new CollabShareClient()
  const pageOrigin = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  const copy =
    clipboard ?? ((text: string) => navigator.clipboard.writeText(text))

  useEffect(() => {
    if (!open) return
    // Load inside the effect via an async IIFE: setState runs only after the
    // await (never synchronously), and the ignore guard drops a stale response
    // if the panel closes or the project changes mid-flight.
    let ignore = false
    void (async () => {
      try {
        const loaded = await api.list(projectId)
        if (ignore) return
        setError(null)
        setLinks(loaded)
      } catch {
        if (!ignore) setError('Could not load share links.')
      }
    })()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  const create = async (role: CollaborationRole) => {
    setBusy(true)
    setError(null)
    try {
      const link = await api.create(projectId, role)
      setLinks((current) => [...current, link])
      await copy(shareLinkUrl(pageOrigin, projectId, link))
      setCopied(link.token)
    } catch {
      setError('Could not create a share link.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: string) => {
    setBusy(true)
    try {
      await api.revoke(projectId, token)
      setLinks((current) => current.filter((l) => l.token !== token))
    } catch {
      setError('Could not revoke the link.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-project">
      <button
        type="button"
        className="btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        Share
      </button>
      {open && (
        <div id={panelId} className="share-panel" role="group" aria-label="Share links">
          <div className="share-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => create('editor')}>
              Create editor link
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => create('viewer')}>
              Create viewer link
            </button>
          </div>
          {error && (
            <p className="share-error" role="alert">
              {error}
            </p>
          )}
          <ul className="share-list">
            {links.map((link) => (
              <li key={link.token} className="share-link">
                <span className="share-role">{ROLE_LABEL[link.role as 'editor' | 'viewer'] ?? link.role}</span>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    await copy(shareLinkUrl(pageOrigin, projectId, link))
                    setCopied(link.token)
                  }}
                >
                  {copied === link.token ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => revoke(link.token)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
