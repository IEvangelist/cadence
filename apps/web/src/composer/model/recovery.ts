import { parseProject, serializeProject } from './persistence'
import type { Project } from './project'
import type { SyncStorage } from './storage'

export const PROJECT_RECOVERY_KEY_PREFIX = 'cadence.v1.recovery'

export const recoveryIndexKey = (scope: string): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.index`

export const projectRecoveryKey = (scope: string, projectId: string): string =>
  `${PROJECT_RECOVERY_KEY_PREFIX}.${encodeURIComponent(scope)}.${encodeURIComponent(projectId)}`

interface ProjectRecoveryEnvelope {
  version: 1
  scope: string
  revision: number
  projectId: string
  project: string
}

interface ProjectRecoveryIndex {
  version: 1
  activeProjectId: string | null
  projectIds: string[]
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
  const resolvedProjectId = projectId ?? readIndex(storage, scope).activeProjectId
  if (!resolvedProjectId) return null
  const raw = storage.getItem(projectRecoveryKey(scope, resolvedProjectId))
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<ProjectRecoveryEnvelope>
    if (
      envelope.version !== 1 ||
      envelope.scope !== scope ||
      typeof envelope.revision !== 'number' ||
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
      projectId: project.id,
      project: serializeProject(project),
    }
    storage.setItem(projectRecoveryKey(scope, project.id), JSON.stringify(envelope))
    const index = readIndex(storage, scope)
    writeIndex(storage, scope, {
      version: 1,
      activeProjectId: project.id,
      projectIds: [project.id, ...index.projectIds.filter((id) => id !== project.id)],
    })
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
    const index = readIndex(storage, scope)
    const projectIds = index.projectIds.filter((id) => id !== projectId)
    if (projectIds.length === 0) {
      storage.removeItem(recoveryIndexKey(scope))
    } else {
      writeIndex(storage, scope, {
        version: 1,
        activeProjectId:
          index.activeProjectId === projectId
            ? projectIds[0]
            : index.activeProjectId,
        projectIds,
      })
    }
  }
}

function readIndex(storage: SyncStorage, scope: string): ProjectRecoveryIndex {
  const raw = storage.getItem(recoveryIndexKey(scope))
  if (!raw) return { version: 1, activeProjectId: null, projectIds: [] }
  try {
    const index = JSON.parse(raw) as Partial<ProjectRecoveryIndex>
    if (
      index.version !== 1 ||
      (index.activeProjectId !== null && typeof index.activeProjectId !== 'string') ||
      !Array.isArray(index.projectIds) ||
      !index.projectIds.every((id) => typeof id === 'string')
    ) {
      return { version: 1, activeProjectId: null, projectIds: [] }
    }
    return {
      version: 1,
      activeProjectId: index.activeProjectId ?? null,
      projectIds: index.projectIds,
    }
  } catch {
    return { version: 1, activeProjectId: null, projectIds: [] }
  }
}

function writeIndex(
  storage: SyncStorage,
  scope: string,
  index: ProjectRecoveryIndex,
): void {
  storage.setItem(recoveryIndexKey(scope), JSON.stringify(index))
}
