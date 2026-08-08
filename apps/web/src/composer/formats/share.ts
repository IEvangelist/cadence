/**
 * Client-side sharing — portable, no backend.
 *
 * Two portable share mechanisms ship here:
 *
 *  1. The `.cadence.json` project file (see `projectFile.ts`) — always available,
 *     any size.
 *  2. A "shareable snapshot" that encodes a *small* project into a URL fragment
 *     (`#project=<base64url>`), so a link alone reopens the piece. Larger
 *     projects exceed a safe URL length and fall back to sharing the file.
 *
 * Hosted, server-backed share links (a real URL + read-only listen view) depend
 * on the projects API from issue #7, which is not merged. That path is
 * intentionally deferred; the contract and the seam are documented in
 * `docs/share.md`. Nothing here talks to a server.
 */
import { type Project } from '../model/project'
import { fileToProject, projectToFile } from './projectFile'

/** URL fragment key carrying an encoded project. */
export const SHARE_FRAGMENT_KEY = 'project'

/**
 * Conservative cap on the whole shareable URL length. Browsers and servers vary,
 * but ~8 KB is broadly safe; above it we advise sharing the file instead.
 */
export const MAX_SHARE_URL_LENGTH = 8000

/**
 * Upper bound on the encoded fragment payload accepted by
 * {@link decodeProjectFromFragment}. The producer already caps the whole URL, but
 * an incoming `#project=…` can be any length; bailing before decode avoids a
 * self-inflicted DoS from a hostile, over-long fragment.
 */
export const MAX_SHARE_FRAGMENT_LENGTH = MAX_SHARE_URL_LENGTH

/** UTF-8 → base64url (URL-fragment safe, no padding). */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url → UTF-8. */
export function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Encode a project into a `#project=…` URL fragment payload (no `#`). */
export function encodeProjectToFragment(project: Project): string {
  return `${SHARE_FRAGMENT_KEY}=${toBase64Url(projectToFile(project, 0))}`
}

/**
 * Decode a project from a URL hash/fragment (`#project=…` or `project=…`).
 * Returns null when no encoded project is present; throws nothing on a malformed
 * payload — it returns null so callers can degrade gracefully.
 */
export function decodeProjectFromFragment(hash: string): Project | null {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(cleaned)
  const encoded = params.get(SHARE_FRAGMENT_KEY)
  if (!encoded) return null
  // Bail before decoding an over-long payload (weak DoS guard); the producer caps
  // the URL, but an inbound fragment can be arbitrarily large.
  if (encoded.length > MAX_SHARE_FRAGMENT_LENGTH) return null
  try {
    return fileToProject(fromBase64Url(encoded))
  } catch {
    return null
  }
}

/** A shareable-URL snapshot that fits within the length budget. */
export interface UrlShareSnapshot {
  kind: 'url'
  url: string
}

/** The project is too large for a URL — share the file instead. */
export interface FileShareSnapshot {
  kind: 'file'
  reason: string
}

export type ShareSnapshot = UrlShareSnapshot | FileShareSnapshot

/** Options for {@link createShareSnapshot}. */
export interface ShareSnapshotOptions {
  /** Base URL to attach the fragment to (defaults to the current location). */
  baseUrl?: string
  maxUrlLength?: number
}

/**
 * Build the best portable snapshot for a project: an encoded URL when it fits,
 * otherwise a signal to fall back to the `.cadence.json` file.
 */
export function createShareSnapshot(
  project: Project,
  options: ShareSnapshotOptions = {},
): ShareSnapshot {
  const maxUrlLength = options.maxUrlLength ?? MAX_SHARE_URL_LENGTH
  const base = options.baseUrl ?? currentBaseUrl()
  const url = `${stripHash(base)}#${encodeProjectToFragment(project)}`
  if (url.length <= maxUrlLength) {
    return { kind: 'url', url }
  }
  return {
    kind: 'file',
    reason:
      'This project is too large for a share link — export the .cadence.json file to share it.',
  }
}

function stripHash(url: string): string {
  const index = url.indexOf('#')
  return index === -1 ? url : url.slice(0, index)
}

function currentBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    return `${window.location.origin}${window.location.pathname}`
  }
  return 'https://cadence.app/'
}
