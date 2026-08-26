/**
 * Parse an opt-in collaboration session out of the current URL + signed-in user.
 *
 * A share link looks like `?collab=<projectId>&role=<role>&share=<token>`. When
 * no `collab` param is present (the normal case) this returns `null` and the app
 * stays fully single-user. The `role` in the URL is only a client-side hint for
 * whether to attempt writes — the relay authorizes every connection and rejects
 * viewer writes server-side, so a tampered role cannot escalate privileges.
 */
import type { CollabConfig, CollaborationRole } from './useCollaboration'
import type { CollabUser } from './collabSession'
import type { OfflineAuthIdentity } from '../../../auth/offlineIdentity'

interface CollabParams {
  projectId: string
  roomOwnerId?: string
  role: CollaborationRole
  token?: string
}

function parseRole(value: string | null): CollaborationRole {
  // Fail closed: an unknown/absent role is treated as the least-privileged.
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : 'viewer'
}

export function parseCollabParams(search: string): CollabParams | null {
  const params = new URLSearchParams(search)
  const projectId = params.get('collab')
  if (!projectId) return null
  return {
    projectId,
    roomOwnerId: params.get('owner') || undefined,
    role: parseRole(params.get('role')),
    token: params.get('share') ?? undefined,
  }
}

/** Derive the WebSocket relay base URL, honoring a build-time override. */
export function resolveRelayUrl(
  location: Pick<Location, 'protocol' | 'host'>,
  override?: string,
): string {
  if (override) return override
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/collab`
}

/** A stable, pleasant avatar color derived from a user id. */
export function colorForId(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  const hue = hash % 360
  return `hsl(${hue} 70% 45%)`
}

export interface BuildCollabConfigInput {
  search: string
  location: Pick<Location, 'protocol' | 'host'>
  user: { id: string; displayName: string } | null
  offlineUser?: OfflineAuthIdentity | null
  relayOverride?: string
}

export function buildCollabConfig(input: BuildCollabConfigInput): CollabConfig | null {
  const parsed = parseCollabParams(input.search)
  const identity = input.user ?? input.offlineUser
  if (!parsed || !identity) return null
  const user: CollabUser = {
    id: identity.id,
    name: identity.displayName,
    color: colorForId(identity.id),
  }
  const roomOwnerId =
    parsed.roomOwnerId ??
    (parsed.role === 'owner'
      ? identity.id
      : 'legacy-owner')
  return {
    projectId: parsed.projectId,
    roomOwnerId,
    networkEnabled: input.user !== null,
    role: parsed.role,
    token: parsed.token,
    url: resolveRelayUrl(input.location, input.relayOverride),
    user,
  }
}
