import { parseProject, serializeProject } from './persistence'
import type { Project } from './project'
import type { SyncStorage } from './storage'

export const PROJECT_RECOVERY_KEY_PREFIX = 'cadence.v1.recovery'

export const recoveryIndexKey = (scope: string): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.active`

export const projectRecoveryKey = (scope: string, projectId: string): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.${encodeURIComponent(projectId)}`

interface ProjectRecoveryEnvelope {
  version: 1
  scope: string
  revision: number
  updatedAt: number
  projectId: string
  project: string
}

interface ProjectRecoveryPointer {
  version: 1
  projectId: string
}

export interface ProjectRecovery {
  revision: number
  project: Project
}

export function defaultRecoveryStorage(): SyncStorage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null
  } catch {
    return null
  }
}

export function readProjectRecovery(
  storage: SyncStorage | null,
  scope: string,
  projectId?: string,
): ProjectRecovery | null {
  if (!storage) return null
  if (projectId) return readRecord(storage, scope, projectId)
  const pointer = readPointer(storage, scope)
  if (pointer) {
    const active = readRecord(storage, scope, pointer.projectId)
    if (active) return active
  }
  const discovered = discoverNewestRecord(storage, scope)
  if (discovered) writePointer(storage, scope, discovered.project.id)
  return discovered
}

function readRecord(
  storage: SyncStorage,
  scope: string,
  projectId: string,
): ProjectRecovery | null {
  const raw = storage.getItem(projectRecoveryKey(scope, projectId))
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<ProjectRecoveryEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.scope !== scope ||
      typeof envelope.revision !== 'number' ||
      typeof envelope.updatedAt !== 'number' ||
      typeof envelope.projectId !== 'string' ||
      typeof envelope.project !== 'string'
    ) {
      return null
    }
    const project = parseProject(envelope.project)
    if (project.id !== envelope.projectId) return null
    return { revision: envelope.revision, project }
  } catch {
    return null
  }
}

export function writeProjectRecovery(
  storage: SyncStorage | null,
  scope: string,
  project: Project,
  revision: number,
): void {
  if (!storage) return
  try {
    const envelope: ProjectRecoveryEnvelope = {
      version: 1,
      scope,
      revision,
      updatedAt: Date.now(),
      projectId: project.id,
      project: serializeProject(project),
    }
    storage.setItem(projectRecoveryKey(scope, project.id), JSON.stringify(envelope))
    writePointer(storage, scope, project.id)
  } catch {
    // Recovery is a best-effort crash boundary and never replaces primary persistence.
  }
}

export function clearProjectRecovery(
  storage: SyncStorage | null,
  scope: string,
  projectId: string,
  persistedRevision: number,
): void {
  if (!storage) return
  const recovery = readProjectRecovery(storage, scope, projectId)
  if (
    recovery &&
    recovery.project.id === projectId &&
    recovery.revision <= persistedRevision
  ) {
    storage.removeItem(projectRecoveryKey(scope, projectId))
    const pointer = readPointer(storage, scope)
    if (pointer?.projectId === projectId) {
      storage.removeItem(recoveryIndexKey(scope))
      const remaining = discoverNewestRecord(storage, scope)
      if (remaining) writePointer(storage, scope, remaining.project.id)
    }
  }
}

function readPointer(storage: SyncStorage, scope: string): ProjectRecoveryPointer | null {
  const raw = storage.getItem(recoveryIndexKey(scope))
  if (!raw) return null
  try {
    const pointer = JSON.parse(raw) as Partial<ProjectRecoveryPointer>
    return pointer.version === 1 && typeof pointer.projectId === 'string'
      ? { version: 1, projectId: pointer.projectId }
      : null
  } catch {
    return null
  }
}

function writePointer(
  storage: SyncStorage,
  scope: string,
  projectId: string,
): void {
  const pointer: ProjectRecoveryPointer = { version: 1, projectId }
  storage.setItem(recoveryIndexKey(scope), JSON.stringify(pointer))
}

function discoverNewestRecord(
  storage: SyncStorage,
  scope: string,
): ProjectRecovery | null {
  if (typeof storage.length !== 'number' || !storage.key) return null
  const prefix = `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.`
  let newest: { recovery: ProjectRecovery; updatedAt: number; projectId: string } | null = null
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix) || key === recoveryIndexKey(scope)) continue
    const encodedProjectId = key.slice(prefix.length)
    let projectId: string
    try {
      projectId = decodeURIComponent(encodedProjectId)
    } catch {
      continue
    }
    const raw = storage.getItem(key)
    if (!raw) continue
    try {
      const envelope = JSON.parse(raw) as Partial<ProjectRecoveryEnvelope>
      const recovery = readRecord(storage, scope, projectId)
      if (!recovery || typeof envelope.updatedAt !== 'number') continue
      if (
        !newest ||
        envelope.updatedAt > newest.updatedAt ||
        (envelope.updatedAt === newest.updatedAt && projectId > newest.projectId)
      ) {
        newest = { recovery, updatedAt: envelope.updatedAt, projectId }
      }
    } catch {
      continue
    }
  }
  return newest?.recovery ?? null
}
