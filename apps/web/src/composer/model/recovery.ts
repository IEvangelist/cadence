import { parseProject, serializeProject } from './persistence'
import type { Project } from './project'
import type { SyncStorage } from './storage'

export const PROJECT_RECOVERY_KEY = 'cadence.v1.recovery'

interface ProjectRecoveryEnvelope {
  version: 1
  revision: number
  projectId: string
  project: string
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

export function readProjectRecovery(storage: SyncStorage | null): ProjectRecovery | null {
  if (!storage) return null
  const raw = storage.getItem(PROJECT_RECOVERY_KEY)
  if (!raw) return null
  try {
    const envelope = JSON.parse(raw) as Partial<ProjectRecoveryEnvelope>
    if (
      envelope.version !== 1 ||
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
  project: Project,
  revision: number,
): void {
  if (!storage) return
  try {
    const envelope: ProjectRecoveryEnvelope = {
      version: 1,
      revision,
      projectId: project.id,
      project: serializeProject(project),
    }
    storage.setItem(PROJECT_RECOVERY_KEY, JSON.stringify(envelope))
  } catch {
    // Recovery is a best-effort crash boundary and never replaces primary persistence.
  }
}

export function clearProjectRecovery(
  storage: SyncStorage | null,
  projectId: string,
  persistedRevision: number,
): void {
  const recovery = readProjectRecovery(storage)
  if (
    recovery &&
    recovery.project.id === projectId &&
    recovery.revision <= persistedRevision
  ) {
    storage?.removeItem(PROJECT_RECOVERY_KEY)
  }
}
