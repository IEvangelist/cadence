/**
 * history.ts — bounded, gesture-aware undo/redo controller for SINGLE-USER mode
 * (#156).
 *
 * This is deliberately NOT Yjs. Collaboration uses `Y.UndoManager` scoped to the
 * shared project doc (see `collab/collabSession.ts`) because CRDT undo has to
 * reason about concurrent peers; single-user editing has no CRDT doc at all, so
 * reusing (or spinning up) a local Yjs document here would add a dependency the
 * offline/solo path never needs. Instead this keeps a small bounded stack of
 * `{ before, after }` project snapshots (see `model/project.ts` / `reducer.ts`),
 * which is both simpler and cheaper for the common single-editor case.
 *
 * Continuous gestures — dragging a note, sliding a knob — fire many rapid state
 * transitions. Capturing every one would make Undo require dozens of presses to
 * peel back a single drag. Entries are coalesced with a small time window that
 * mirrors `Y.UndoManager`'s own `captureTimeout` (default 500ms): a push that
 * lands within `captureTimeoutMs` of the previous push AND shares its
 * `groupKey` extends the active entry's `after` value instead of creating a new
 * one. Pushes with no `groupKey` (discrete one-shot commands — add a note,
 * rename a track, delete a track…) never coalesce with anything, even if they
 * land back-to-back. Call `stopCapturing()` to force the next push to start a
 * fresh entry even if it arrives quickly after the last one (e.g. on pointer-up,
 * were a caller to want an explicit boundary rather than relying on the timeout).
 */

/** One undo-able transition: the value to restore on undo / reapply on redo. */
export interface HistoryEntry<T> {
  before: T
  after: T
}

export interface HistoryControllerOptions {
  /** Maximum number of undo entries retained; oldest entries drop silently. */
  limit?: number
  /** Pushes within this window of the previous push may coalesce (see above). */
  captureTimeoutMs?: number
  /** Clock injection for deterministic tests. Defaults to `Date.now`. */
  now?: () => number
}

export interface HistoryController<T> {
  /**
   * Record a transition from `before` to `after`. Clears the redo stack (a new
   * edit invalidates whatever redo history existed). When `groupKey` matches
   * the most recent push's `groupKey` AND arrives within `captureTimeoutMs`,
   * the active entry's `after` is updated in place instead of growing the
   * stack — this is what collapses a pointer drag into one undo step.
   */
  push: (before: T, after: T, groupKey?: string) => void
  /** Force the next `push` to start a new entry regardless of timing/group. */
  stopCapturing: () => void
  /** Pop the most recent entry and return its `before` value, or `undefined`. */
  undo: () => T | undefined
  /** Reapply the most recently undone entry's `after`, or `undefined`. */
  redo: () => T | undefined
  canUndo: () => boolean
  canRedo: () => boolean
  /** Discard all history — used on load/import/restore/remote-sync reset. */
  clear: () => void
}

/** Bound applied to single-user history (issue #156). */
export const DEFAULT_HISTORY_LIMIT = 100
/** Mirrors `Y.UndoManager`'s own default `captureTimeout`. */
export const DEFAULT_CAPTURE_TIMEOUT_MS = 500

export function createHistoryController<T>(
  options: HistoryControllerOptions = {},
): HistoryController<T> {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT
  const captureTimeoutMs = options.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS
  const now = options.now ?? (() => Date.now())

  let past: HistoryEntry<T>[] = []
  let future: HistoryEntry<T>[] = []
  let lastGroupKey: string | undefined
  let lastPushAt = -Infinity
  // Whether the most recent push may still be extended by a coalescing push.
  let capturing = false

  return {
    push(before, after, groupKey) {
      const timestamp = now()
      const withinWindow = timestamp - lastPushAt <= captureTimeoutMs
      const sameGroup = groupKey !== undefined && groupKey === lastGroupKey
      if (capturing && sameGroup && withinWindow && past.length > 0) {
        past[past.length - 1].after = after
      } else {
        past.push({ before, after })
        if (past.length > limit) past.shift()
      }
      capturing = true
      lastGroupKey = groupKey
      lastPushAt = timestamp
      future = []
    },
    stopCapturing() {
      capturing = false
    },
    undo() {
      const entry = past.pop()
      if (!entry) return undefined
      future.push(entry)
      capturing = false
      lastGroupKey = undefined
      return entry.before
    },
    redo() {
      const entry = future.pop()
      if (!entry) return undefined
      past.push(entry)
      if (past.length > limit) past.shift()
      capturing = false
      lastGroupKey = undefined
      return entry.after
    },
    canUndo() {
      return past.length > 0
    },
    canRedo() {
      return future.length > 0
    },
    clear() {
      past = []
      future = []
      capturing = false
      lastGroupKey = undefined
      lastPushAt = -Infinity
    },
  }
}
