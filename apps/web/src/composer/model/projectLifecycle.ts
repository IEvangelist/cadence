import type { Project } from './project'

export type ProjectHydrationState =
  | { status: 'hydrating' }
  | {
      status: 'ready-with-project'
      source: 'injected' | 'shared' | 'recovery' | 'last' | 'created'
    }
  | { status: 'ready-without-project' }
  | { status: 'restore-error'; message: string }

export type ProjectSaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

export interface ProjectSaveState {
  status: ProjectSaveStatus
  revision: number
  persistedRevision: number
  savingRevision: number | null
  savedAt: number | null
  message: string | null
}

export interface ProjectActionMessage {
  id: number
  tone: 'info' | 'success' | 'error'
  text: string
}

export type ProjectReplacementSource =
  | 'blank'
  | 'demo'
  | 'template'
  | 'open'
  | 'import-project'
  | 'import-musicxml'
  | 'import-midi'
  | 'import-plugin'

export interface ProjectReplacementRequest {
  source: ProjectReplacementSource
  project?: Project
  loadId?: string
  label: string
  persisted: boolean
}

export type ProjectReplacementState =
  | { status: 'idle' }
  | { status: 'flushing'; request: ProjectReplacementRequest }
  | { status: 'blocked'; request: ProjectReplacementRequest; message: string }

export type ProjectReplacementResult = 'replaced' | 'blocked' | 'failed'

export type RecentProjectsState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string }

export const initialSaveState = (status: 'clean' | 'dirty' = 'clean'): ProjectSaveState => ({
  status,
  revision: status === 'dirty' ? 1 : 0,
  persistedRevision: 0,
  savingRevision: null,
  savedAt: null,
  message: null,
})
