/**
 * Multi-track piano-roll visibility (#131).
 *
 * Which tracks the piano roll draws is a VIEW concern, so it lives here as a
 * pure selector rather than in the persisted {@link Project}. The active
 * (selected) track is ALWAYS visible — it is the one being edited — plus any
 * other tracks the user has toggled on as read-only context. Keeping this pure
 * (no React, no DOM) makes it trivially unit-testable and lets the controller
 * memoize it so unrelated renders don't recompute the overlay.
 */
import type { Track } from './project'

/**
 * The tracks rendered on the piano roll, in project order (stable legend + note
 * z-stack). Always includes the `selectedTrackId` track when it exists; every
 * other track appears only when its id is in `contextTrackIds`. Stale ids in
 * `contextTrackIds` (e.g. a since-removed track) are ignored because the result
 * is filtered from the live `tracks`.
 */
export function selectVisibleTracks(
  tracks: readonly Track[],
  contextTrackIds: ReadonlySet<string>,
  selectedTrackId: string,
): Track[] {
  return tracks.filter(
    (track) => track.id === selectedTrackId || contextTrackIds.has(track.id),
  )
}

/**
 * Ids of the visible tracks (see {@link selectVisibleTracks}). Convenience for
 * the controller surface, which exposes ids rather than track objects so
 * consumers keep reading tracks from the single `project` source of truth.
 */
export function selectVisibleTrackIds(
  tracks: readonly Track[],
  contextTrackIds: ReadonlySet<string>,
  selectedTrackId: string,
): string[] {
  return selectVisibleTracks(tracks, contextTrackIds, selectedTrackId).map(
    (track) => track.id,
  )
}
