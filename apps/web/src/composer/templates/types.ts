/**
 * Types for the built-in **house dubs** — professionally arranged, multi-track
 * quick-start songs a newcomer can load in one click (like GarageBand's demo
 * songs). Each template materializes a full {@link Project} the existing
 * `load-project` reducer path consumes; the registry is intentionally data-only
 * and lives OUTSIDE `plugins/builtins/**` so it never collides with the
 * instrument-library lane — it only *consumes* instrument ids from it.
 */
import type { Project } from '../model/project'

/** A one-click house dub: metadata plus a factory that builds a fresh Project. */
export interface SongTemplate {
  /** Unique kebab-case id (stable across sessions; used as a React key). */
  id: string
  /** Display name shown in the Quick Starts gallery. */
  name: string
  /** One-line description of the groove/vibe. */
  description: string
  /** Genre bucket the gallery groups by, e.g. `'Lo-Fi Hip-Hop'`. */
  genre: string
  /** Tempo in BPM (mirrors the built project so the gallery can show it). */
  tempo: number
  /**
   * Build a fully-formed, valid {@link Project} with FRESH ids on every call, so
   * loading the same template twice never reuses note/track/project ids. The
   * result is compatible with the reducer's `load-project` action as-is.
   */
  build: () => Project
}

/** A genre bucket of templates, preserving registry order. */
export interface TemplateGroup {
  genre: string
  templates: SongTemplate[]
}
