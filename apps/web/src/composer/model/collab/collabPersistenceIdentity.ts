import type { CollabConfig } from './useCollaboration'

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Opaque stable scope; no share capability is exposed in browser storage keys. */
export async function collabPersistenceScopeId(
  config: CollabConfig,
): Promise<string> {
  const material = JSON.stringify([
    config.url,
    config.user.id,
    config.roomOwnerId,
    config.projectId,
    config.token ?? `owner:${config.user.id}`,
  ])
  return toHex(
    await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(material),
    ),
  )
}

export async function collabPersistenceName(
  config: CollabConfig,
): Promise<string> {
  const scopeId = await collabPersistenceScopeId(config)
  return `cadence.collab.v1:${encodeURIComponent(config.user.id)}:${scopeId}`
}
