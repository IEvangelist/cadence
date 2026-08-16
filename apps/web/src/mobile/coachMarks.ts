export type CoachMarkId =
  | 'project-actions'
  | 'track-instruments'
  | 'note-modes'
  | 'ai-review'
  | 'shortcut-help'

export interface CoachMarkDefinition {
  id: CoachMarkId
  task: 'project' | 'tracks' | 'notes' | 'tools'
  title: string
  body: string
}

export interface CoachMarkStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// Public localStorage namespace, not a credential.
export const COACH_MARKS_STORAGE_KEY = 'cadence.v1.coach-marks' // gitleaks:allow

export const COACH_MARKS: readonly CoachMarkDefinition[] = [
  {
    id: 'project-actions',
    task: 'project',
    title: 'Your project lives here',
    body: 'Create, open, import, save, share, and export from Project.',
  },
  {
    id: 'track-instruments',
    task: 'tracks',
    title: 'Shape the arrangement',
    body: 'Pick a track, then choose the instrument that should play it.',
  },
  {
    id: 'note-modes',
    task: 'notes',
    title: 'Pan first, draw on purpose',
    body: 'Pan/Select is safe by default. Switch to Draw before adding notes.',
  },
  {
    id: 'ai-review',
    task: 'tools',
    title: 'Review every AI idea',
    body: 'Preview a suggestion, then accept it or discard it.',
  },
  {
    id: 'shortcut-help',
    task: 'tools',
    title: 'A keyboard still works',
    body: 'Open Help to see shortcuts when a keyboard is attached.',
  },
] as const

export class MemoryCoachMarkStorage implements CoachMarkStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

export function createDefaultCoachMarkStorage(): CoachMarkStorage {
  try {
    return typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      globalThis.localStorage
      ? globalThis.localStorage
      : new MemoryCoachMarkStorage()
  } catch {
    return new MemoryCoachMarkStorage()
  }
}

export function readSeenCoachMarks(storage: CoachMarkStorage): Set<CoachMarkId> {
  try {
    const raw = storage.getItem(COACH_MARKS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    const valid = new Set(COACH_MARKS.map((mark) => mark.id))
    return new Set(
      parsed.filter(
        (value): value is CoachMarkId =>
          typeof value === 'string' && valid.has(value as CoachMarkId),
      ),
    )
  } catch {
    return new Set()
  }
}

export function markCoachMarkSeen(
  storage: CoachMarkStorage,
  seen: ReadonlySet<CoachMarkId>,
  id: CoachMarkId,
): Set<CoachMarkId> {
  const next = new Set(seen)
  next.add(id)
  try {
    storage.setItem(COACH_MARKS_STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Guidance is optional and must never block composing.
  }
  return next
}

export function nextCoachMark(
  task: CoachMarkDefinition['task'],
  seen: ReadonlySet<CoachMarkId>,
): CoachMarkDefinition | null {
  return COACH_MARKS.find((mark) => mark.task === task && !seen.has(mark.id)) ?? null
}
