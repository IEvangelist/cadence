/**
 * Compile-time conformance checks for the published composer contract.
 *
 * Conformance is deliberately FORWARD-ONLY: the live ComposerController must
 * provide everything the frozen ComposerPublicApi promises, but it MAY carry
 * additional INTERNAL members (e.g. effort #9's collaboration sync plumbing)
 * that the public contract intentionally excludes. A bidirectional exact-match
 * would fail the instant this module is rebased on top of #9's merge.
 */
import type { ComposerController } from '../hooks/useComposer'
import type { ComposerPublicApi } from './core'

/**
 * Forward conformance (HARD GUARANTEE): the live ComposerController is assignable
 * to ComposerPublicApi, so it provides every public member with a compatible
 * type. Assignability also rejects hallucinated or mistyped members in the
 * contract, because a public member absent from the controller breaks the check.
 */
export type ControllerImplementsContract = ComposerController extends ComposerPublicApi ? true : never
export const controllerImplementsContract: ControllerImplementsContract = true

/**
 * Public/Internal boundary guard (#9 live collaboration).
 *
 * The public contract intentionally EXCLUDES collaboration sync plumbing that
 * effort #9 adds to the runtime: `ComposerController.applyRemoteProject`, the
 * `sync-remote` reducer action, and the `<Composer collabProviderFactory>` prop.
 * Features build against the read-only `CollaborationStatus` surface instead.
 *
 * This fails `tsc` if any known-internal member ever leaks into the public
 * contract, so the boundary cannot silently erode as #9 lands.
 */
export type CollaborationInternalMember = 'applyRemoteProject'
export type PublicApiExcludesCollabInternals =
  CollaborationInternalMember extends keyof ComposerPublicApi ? never : true
export const publicApiExcludesCollabInternals: PublicApiExcludesCollabInternals = true
