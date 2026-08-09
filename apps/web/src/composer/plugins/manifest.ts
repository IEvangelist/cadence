/**
 * Hand-rolled, dependency-free plugin manifest validation.
 *
 * Mirrors the defensive style of `model/persistence.ts` and the typed-error
 * pattern of `MidiImportError`/`ProjectFileError`: an untrusted manifest is
 * validated into a well-formed {@link PluginManifest} or rejected with a
 * {@link PluginManifestError} carrying a human-readable reason. No schema
 * library is used (zero new runtime deps).
 */
import type { PluginManifest } from './types'

/** Thrown when a plugin manifest is missing/typed-wrong. */
export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

/** `MAJOR.MINOR.PATCH` with an optional `-prerelease` / `+build` suffix. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Safe id charset: a lowercase alphanumeric start, then up to 63 more lowercase
 * alphanumerics, dots, dashes, or underscores. Ids are used as plain-object keys
 * for the enable/keybinding/panel gates, so this deliberately excludes anything
 * that could shadow an `Object.prototype` member or carry surprising characters.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

/**
 * Names that (case-insensitively) collide with `Object.prototype` members. The
 * charset already blocks most of them, but `constructor`/`prototype` slip through
 * as plain lowercase words, so they are rejected explicitly. Belt-and-suspenders:
 * an id must never be usable to reach the prototype chain via `map[id]`.
 */
const RESERVED_IDS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'hasownproperty',
  'isprototypeof',
  'propertyisenumerable',
  'tolocalestring',
  'tostring',
  'valueof',
])

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

/**
 * True when `value` is a safe id (see {@link SAFE_ID}) that does not collide with
 * an `Object.prototype` member. Exported so other seams that key maps by an
 * untrusted id can reject unsafe values the same way.
 */
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !RESERVED_IDS.has(value.toLowerCase())
}

/**
 * Validate an untrusted value into a {@link PluginManifest}. Returns a fresh,
 * normalized object (only known fields) or throws {@link PluginManifestError}.
 */
export function validateManifest(raw: unknown): PluginManifest {
  if (raw === null || typeof raw !== 'object') {
    throw new PluginManifestError('Manifest must be an object')
  }
  const m = raw as Record<string, unknown>

  if (!isSafeId(m.id)) {
    throw new PluginManifestError(
      'Manifest "id" must be a safe identifier: a lowercase alphanumeric start then ' +
        'letters, digits, dots, dashes, or underscores (max 64 chars), and not a reserved name',
    )
  }
  if (!isNonEmptyString(m.name)) {
    throw new PluginManifestError(`Plugin "${m.id}" manifest "name" must be a non-empty string`)
  }
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) {
    throw new PluginManifestError(
      `Plugin "${m.id}" manifest "version" must be a semantic version like 1.0.0`,
    )
  }
  if (m.description !== undefined && typeof m.description !== 'string') {
    throw new PluginManifestError(`Plugin "${m.id}" manifest "description" must be a string`)
  }
  if (m.author !== undefined && typeof m.author !== 'string') {
    throw new PluginManifestError(`Plugin "${m.id}" manifest "author" must be a string`)
  }

  const manifest: PluginManifest = {
    id: m.id,
    name: m.name,
    version: m.version,
  }
  if (m.description !== undefined) manifest.description = m.description
  if (m.author !== undefined) manifest.author = m.author
  if (m.builtin === true) manifest.builtin = true
  return manifest
}
