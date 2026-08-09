import type { CollabPresence } from '../model/collab/collabSession'

interface PresenceBarProps {
  presence: CollabPresence[]
  connected: boolean
  canWrite: boolean
  /** Resolve a track id to a display name for cursor captions. */
  resolveTrackName?: (trackId: string) => string | undefined
}

/** Two initials for an avatar, derived from the collaborator's name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Choose black or white text for a colored avatar so the initials always meet
 * WCAG AA contrast (keeps the presence bar axe-clean regardless of user color).
 * Accepts hex (#rgb / #rrggbb) or `hsl(h s% l%)` backgrounds. Picking the ink at
 * the 0.179 relative-luminance crossover guarantees at least 4.58:1 for any hue.
 */
function readableInk(bg: string): string {
  const [r, g, b] = toRgb(bg)
  const lin = (channel: number) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

/** Parse a hex (#rgb / #rrggbb) or `hsl(h s% l%)` color into 0–255 RGB. */
function toRgb(color: string): [number, number, number] {
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full =
      hex.length === 3
        ? hex.split('').map((ch) => ch + ch).join('')
        : hex.padEnd(6, '0').slice(0, 6)
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const hsl = c.match(/hsl\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/i)
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100)
  return [0, 0, 0]
}

/** Convert HSL (h in degrees, s/l in 0–1) to 0–255 RGB. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((hp % 2) - 1))
  const [r, g, b] =
    hp < 1
      ? [chroma, x, 0]
      : hp < 2
        ? [x, chroma, 0]
        : hp < 3
          ? [0, chroma, x]
          : hp < 4
            ? [0, x, chroma]
            : hp < 5
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = l - chroma / 2
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function cursorCaption(
  presence: CollabPresence,
  resolveTrackName?: (trackId: string) => string | undefined,
): string | null {
  const cursor = presence.cursor
  if (!cursor || !cursor.trackId) return null
  const trackName = resolveTrackName?.(cursor.trackId) ?? 'a track'
  const count = cursor.selectedNoteIds.length
  if (count > 0) return `editing ${trackName} · ${count} note${count === 1 ? '' : 's'}`
  return `viewing ${trackName}`
}

/**
 * Presence roster for a collaborative session: avatars + names of connected
 * collaborators with their live cursor/selection, plus a read-only badge for
 * viewers and a polite connection-status announcement. Driven entirely by Yjs
 * awareness state.
 */
export function PresenceBar({
  presence,
  connected,
  canWrite,
  resolveTrackName,
}: PresenceBarProps) {
  // Self first, then others by name for a stable, predictable order.
  const ordered = [...presence].sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
    return a.user.name.localeCompare(b.user.name)
  })

  return (
    <section className="presence-bar" aria-label="Collaborators">
      <p className="presence-status" role="status">
        {connected ? 'Connected' : 'Connecting…'} · {presence.length}{' '}
        {presence.length === 1 ? 'person' : 'people'}
      </p>
      <ul className="presence-list">
        {ordered.map((person) => {
          const caption = cursorCaption(person, resolveTrackName)
          const label = person.isSelf ? `${person.user.name} (you)` : person.user.name
          return (
            <li key={person.clientId} className="presence-item">
              <span
                className="presence-avatar"
                style={{
                  backgroundColor: person.user.color,
                  color: readableInk(person.user.color),
                }}
                aria-hidden="true"
              >
                {initials(person.user.name)}
              </span>
              <span className="presence-meta">
                <span className="presence-name">{label}</span>
                {caption && <span className="presence-cursor">{caption}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {!canWrite && (
        <p className="presence-role" role="note">
          Read-only
        </p>
      )}
    </section>
  )
}
