import { parseProject, serializeProject } from './persistence'
import type { Project } from './project'
import type { SyncStorage } from './storage'

export const PROJECT_RECOVERY_KEY_PREFIX = 'cadence.v1.recovery'

export const recoveryIndexKey = (scope: string): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.active`

export const projectRecoveryKey = (
  scope: string,
  projectId: string,
  token: string,
): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.${encodeURIComponent(projectId)}.${encodeURIComponent(token)}`

interface ProjectRecoveryEnvelope {
  version: 1
  scope: string
  token: string
  revision: number
  updatedAt: number
  projectId: string
  project: string
}

interface ProjectRecoveryPointer {
  version: 1
  projectId: string
  token: string
}

export interface ProjectRecovery {
  token: string
  revision: number
  updatedAt: number
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
  const pointer = readPointer(storage, scope)
  const active =
    pointer && (!projectId || pointer.projectId === projectId)
      ? readRecord(storage, scope, pointer.projectId, pointer.token)
      : null
  const discovered = discoverNewestRecord(storage, scope, projectId)
  const selected =
    active && discovered && active.updatedAt === discovered.updatedAt
      ? active
      : newerRecovery(active, discovered)
  if (
    selected &&
    (pointer?.projectId !== selected.project.id || pointer.token !== selected.token)
  ) {
    writePointer(storage, scope, selected.project.id, selected.token)
  }
  return selected
}

export function writeProjectRecovery(
  storage: SyncStorage | null,
  scope: string,
  project: Project,
  revision: number,
  previousToken?: string | null,
): string | null {
  if (!storage) return null
  const token = newRecoveryToken()
  try {
    const envelope: ProjectRecoveryEnvelope = {
      version: 1,
      scope,
      token,
      revision,
      updatedAt: Date.now(),
      projectId: project.id,
      project: serializeProject(project),
    }
    storage.setItem(
      projectRecoveryKey(scope, project.id, token),
      JSON.stringify(envelope),
    )
    writePointer(storage, scope, project.id, token)
    if (previousToken && previousToken !== token) {
      storage.removeItem(projectRecoveryKey(scope, project.id, previousToken))
    }
    return token
  } catch {
    return null
  }
}

export function clearProjectRecovery(
  storage: SyncStorage | null,
  scope: string,
  projectId: string,
  token: string | null,
): void {
  if (!storage || !token) return
  storage.removeItem(projectRecoveryKey(scope, projectId, token))
  const pointer = readPointer(storage, scope)
  if (pointer?.projectId === projectId && pointer.token === token) {
    storage.removeItem(recoveryIndexKey(scope))
    const remaining = discoverNewestRecord(storage, scope)
    if (remaining) {
      writePointer(storage, scope, remaining.project.id, remaining.token)
    }
  }
}

function readRecord(
  storage: SyncStorage,
  scope: string,
  projectId: string,
  token: string,
): ProjectRecovery | null {
  const raw = storage.getItem(projectRecoveryKey(scope, projectId, token))
  if (!raw) return null
  return parseEnvelope(raw, scope, projectId, token)
}

function parseEnvelope(
  raw: string,
  scope: string,
  projectId?: string,
  token?: string,
): ProjectRecovery | null {
  try {
    const envelope = JSON.parse(raw) as Partial<ProjectRecoveryEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.scope !== scope ||
      typeof envelope.token !== 'string' ||
      typeof envelope.revision !== 'number' ||
      typeof envelope.updatedAt !== 'number' ||
      typeof envelope.projectId !== 'string' ||
      typeof envelope.project !== 'string' ||
      (projectId && envelope.projectId !== projectId) ||
      (token && envelope.token !== token)
    ) {
      return null
    }
    const project = parseProject(envelope.project)
    if (project.id !== envelope.projectId) return null
    return {
      token: envelope.token,
      revision: envelope.revision,
      updatedAt: envelope.updatedAt,
      project,
    }
  } catch {
    return null
  }
}

function discoverNewestRecord(
  storage: SyncStorage,
  scope: string,
  projectId?: string,
): ProjectRecovery | null {
  if (typeof storage.length !== 'number' || !storage.key) return null
  const prefix = `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.`
  let newest: ProjectRecovery | null = null
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(prefix) || key === recoveryIndexKey(scope)) continue
    const raw = storage.getItem(key)
    if (!raw) continue
    const recovery = parseEnvelope(raw, scope)
    if (!recovery || (projectId && recovery.project.id !== projectId)) continue
    newest = newerRecovery(newest, recovery)
  }
  return newest
}

function newerRecovery(
  first: ProjectRecovery | null,
  second: ProjectRecovery | null,
): ProjectRecovery | null {
  if (!first) return second
  if (!second) return first
  if (second.updatedAt !== first.updatedAt) {
    return second.updatedAt > first.updatedAt ? second : first
  }
  return second.token > first.token ? second : first
}

function readPointer(storage: SyncStorage, scope: string): ProjectRecoveryPointer | null {
  const raw = storage.getItem(recoveryIndexKey(scope))
  if (!raw) return null
  try {
    const pointer = JSON.parse(raw) as Partial<ProjectRecoveryPointer>
    return pointer.version === 1 &&
      typeof pointer.projectId === 'string' &&
      typeof pointer.token === 'string'
      ? { version: 1, projectId: pointer.projectId, token: pointer.token }
      : null
  } catch {
    return null
  }
}

function writePointer(
  storage: SyncStorage,
  scope: string,
  projectId: string,
  token: string,
): void {
  const pointer: ProjectRecoveryPointer = { version: 1, projectId, token }
  storage.setItem(recoveryIndexKey(scope), JSON.stringify(pointer))
}

function newRecoveryToken(): string {
  const cryptoApi = globalThis.crypto
  return cryptoApi && typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
