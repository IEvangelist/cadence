export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const ONBOARDING_SEEN_KEY = 'cadence.v1.onboarding.seen'

export class MemoryOnboardingStorage implements OnboardingStorage {
  private readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

export function createDefaultOnboardingStorage(): OnboardingStorage {
  try {
    const candidate =
      typeof globalThis !== 'undefined' &&
      'localStorage' in globalThis &&
      typeof globalThis.localStorage !== 'undefined'
        ? globalThis.localStorage
        : null

    return candidate ?? new MemoryOnboardingStorage()
  } catch {
    return new MemoryOnboardingStorage()
  }
}

export function readOnboardingSeen(storage: OnboardingStorage): boolean {
  try {
    return storage.getItem(ONBOARDING_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markOnboardingSeen(storage: OnboardingStorage): void {
  try {
    storage.setItem(ONBOARDING_SEEN_KEY, '1')
  } catch {
    // localStorage can be unavailable or denied; onboarding must never block use.
  }
}
