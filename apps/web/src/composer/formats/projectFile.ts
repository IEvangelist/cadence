/**
 * Portable, versioned project file (`.cadence.json`).
 *
 * A self-contained document that carries the full {@link Project} model so users
 * can save, share, and reopen projects as files — independent of browser storage
 * or any backend. The on-disk shape is a small envelope wrapping the project,
 * which lets the loader recognise the format and route the payload through the
 * same {@link migrateProject} seam used by localStorage persistence (so older
 * files upgrade rather than crash).
 */
import { SCHEMA_VERSION, type Project } from '../model/project'
import { migrateProject } from '../model/persistence'

/** Discriminator stored in the envelope so foreign JSON is rejected cleanly. */
export const PROJECT_FILE_FORMAT = 'cadence-project'

/** Envelope version — bump when the wrapper shape (not the project) changes. */
export const PROJECT_FILE_VERSION = 1

/** File extension for downloads (double-extension keeps it JSON-friendly). */
export const PROJECT_FILE_EXTENSION = '.cadence.json'

/** MIME type used for the download blob. */
export const PROJECT_FILE_MIME = 'application/json'

/** The self-describing envelope written to disk. */
export interface ProjectFileEnvelope {
  format: typeof PROJECT_FILE_FORMAT
  /** Envelope version. */
  version: number
  /** Project schema version at export time (informational; the payload wins). */
  schemaVersion: number
  /** Millisecond timestamp the file was exported. */
  exportedAt: number
  project: Project
}

/** Thrown when a file cannot be read as a Cadence project document. */
export class ProjectFileError extends Error {
  constructor(message = 'Could not read the file as a Cadence project') {
    super(message)
    this.name = 'ProjectFileError'
  }
}

/** Serialize a project to a pretty-printed, self-contained file string. */
export function projectToFile(project: Project, now: number = Date.now()): string {
  const envelope: ProjectFileEnvelope = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    schemaVersion: project.schemaVersion ?? SCHEMA_VERSION,
    exportedAt: now,
    project,
  }
  return JSON.stringify(envelope, null, 2)
}

/** Options for {@link fileToProject}. */
export interface ProjectFileImportOptions {
  id?: string
  name?: string
}

/**
 * Parse a `.cadence.json` file string into a validated, migrated project.
 *
 * Accepts both the enveloped shape and a bare project document (so a file that
 * only contains the raw project — e.g. hand-authored or from a future exporter —
 * still loads). Malformed JSON or a non-project payload throws
 * {@link ProjectFileError}, mirroring the `MidiImportError` pattern.
 */
export function fileToProject(
  raw: string,
  options: ProjectFileImportOptions = {},
): Project {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ProjectFileError('The file is not valid JSON')
  }

  if (data === null || typeof data !== 'object') {
    throw new ProjectFileError('The file does not contain a project')
  }

  const record = data as Record<string, unknown>
  // Prefer the enveloped payload; fall back to treating the document as a bare
  // project so both shapes round-trip.
  const looksEnveloped = record.format !== undefined || record.project !== undefined
  if (looksEnveloped && record.format !== PROJECT_FILE_FORMAT) {
    throw new ProjectFileError('Unrecognised file format')
  }
  const payload = looksEnveloped ? record.project : record

  let project: Project
  try {
    project = migrateProject(payload)
  } catch (cause) {
    throw new ProjectFileError(
      cause instanceof Error ? cause.message : 'The project could not be read',
    )
  }

  return {
    ...project,
    id: options.id ?? project.id,
    name: options.name ?? project.name,
  }
}
