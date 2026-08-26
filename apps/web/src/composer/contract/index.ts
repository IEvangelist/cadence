/**
 * Composer contract barrel.
 *
 * See docs/composer-api.md. Versioning follows semver: additive seams are minor
 * bumps, while changes to the frozen core surface are major.
 */
export * from './core'
export * from './collaboration'
export * from './collaborationContext'
export * from './instruments'
export * from './onboarding'
export * from './platform'
export * from './mixing'
export * from './ai'
export * from './export'
export * from './conformance'
export * from './collaborationSelector'

/** Current published composer contract version. */
export const COMPOSER_CONTRACT_VERSION = '1.3.0'
