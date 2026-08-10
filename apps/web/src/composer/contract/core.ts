/**
 * Published composer core contract.
 *
 * This module is the stable import seam for the current composer model,
 * persistence, audio, hook, AI, plugin, instrument, and sharing APIs. It also
 * hand-writes the frozen controller surface that feature efforts should consume.
 */
import type { TransportState } from '../audio/engine'
import type { FormatContribution } from '../plugins/types'
import type { InstrumentId, Note, Project } from '../model/project'
import type { ComposerState } from '../model/reducer'
import type { StoredProjectMeta } from '../model/storage'
import type { ShareSnapshot } from '../formats/share'

// ---------------------------------------------------------------------------
// Project model
// ---------------------------------------------------------------------------

export type { Pitch, InstrumentId, Note, Track, LoopRegion, Project } from '../model/project'
export {
  SCHEMA_VERSION,
  DEFAULT_PPQ,
  BEATS_PER_BAR,
  DEFAULT_TEMPO,
  MIN_PITCH,
  MAX_PITCH,
  TRACK_COLORS,
  newId,
  pitchToName,
  isBlackKey,
  createNote,
  createTrack,
  createEmptyProject,
  createDemoProject,
  trackColorForIndex,
} from '../model/project'

// ---------------------------------------------------------------------------
// Reducer/state model
// ---------------------------------------------------------------------------

export type { ComposerState, ComposerAction } from '../model/reducer'
export {
  MIN_NOTE_DURATION,
  composerReducer,
  initialState,
  selectedTrack,
} from '../model/reducer'

// ---------------------------------------------------------------------------
// Persistence and storage
// ---------------------------------------------------------------------------

export type { ProjectStore, StoredProjectMeta, SyncStorage } from '../model/storage'
export { LocalStorageProjectStore, MemoryStorage, createProjectStore } from '../model/storage'
export type { AuthFlag } from '../model/syncingStore'
export { SyncingProjectStore } from '../model/syncingStore'
export { RemoteProjectStore } from '../model/remoteStore'
export {
  migrateProject,
  serializeProject,
  parseProject,
  ProjectParseError,
} from '../model/persistence'

// ---------------------------------------------------------------------------
// Audio engine
// ---------------------------------------------------------------------------

export type { AudioEngine, TransportState } from '../audio/engine'
export { createAudioEngine, isAudioSupported } from '../audio/engine'

// ---------------------------------------------------------------------------
// React hook controllers
// ---------------------------------------------------------------------------

export type { ComposerController, UseComposerOptions } from '../hooks/useComposer'
export type { AssistantController, UseAssistantOptions } from '../hooks/useAssistant'

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export type {
  AssistantAction,
  SuggestedNote,
  AssistantParams,
  AssistantRequest,
  AssistantSuggestion,
  AssistantPhase,
  AssistantProgress,
  CompositionAssistant,
} from '../ai/types'
export { DEFAULT_PARAMS, TEMPERATURE_RANGE, LENGTH_RANGE, isAbortError } from '../ai/types'

// ---------------------------------------------------------------------------
// Plugin SDK contribution types
// ---------------------------------------------------------------------------

export type {
  PluginManifest,
  SemVer,
  InstrumentKind,
  InstrumentDefinition,
  InstrumentVoice,
  InstrumentVoiceContext,
  InstrumentVoiceFactory,
  InstrumentContribution,
  EffectNode,
  EffectContext,
  EffectFactory,
  EffectContribution,
  FormatImportOptions,
  FormatContribution,
  AiProviderContribution,
  CommandNote,
  CommandApi,
  CommandContribution,
  PanelRenderContext,
  PanelContribution,
  PluginContributions,
  PluginHostApi,
  CadencePlugin,
} from '../plugins'

// ---------------------------------------------------------------------------
// Instrument registry
// ---------------------------------------------------------------------------

export {
  listInstruments,
  getInstrument,
  getInstrumentContribution,
  INSTRUMENTS,
  DRUM_MAP,
  drumLabel,
} from '../instruments/registry'

// ---------------------------------------------------------------------------
// Sharing formats
// ---------------------------------------------------------------------------

export type {
  ShareSnapshot,
  UrlShareSnapshot,
  FileShareSnapshot,
  ShareSnapshotOptions,
} from '../formats/share'
export {
  createShareSnapshot,
  encodeProjectToFragment,
  decodeProjectFromFragment,
} from '../formats/share'

// ---------------------------------------------------------------------------
// Billing entitlement view
// ---------------------------------------------------------------------------

export type { Entitlements } from '../../billing/entitlementsClient'

/**
 * FROZEN surface features consume.
 *
 * This standalone published interface mirrors the live {@link ComposerController}.
 * The conformance test in `contract/conformance.ts` binds this contract to the
 * implementation with FORWARD conformance (the controller must satisfy this
 * surface) so drift fails `tsc`. The controller may additionally expose INTERNAL
 * members — e.g. effort #9's `applyRemoteProject` sync path — that are
 * deliberately excluded from this public surface.
 */
export interface ComposerPublicApi {
  state: ComposerState
  project: Project
  selectedTrackId: string
  transportState: TransportState
  positionBeats: number
  snap: number
  setSnap: (grid: number) => void
  savedProjects: StoredProjectMeta[]
  status: string
  audioReady: boolean
  notify: (message: string) => void
  play: () => void
  pause: () => void
  stop: () => void
  togglePlay: () => void
  setTempo: (bpm: number) => void
  toggleLoop: () => void
  addNoteAt: (trackId: string, pitch: number, start: number, duration?: number) => void
  insertNotes: (
    trackId: string,
    notes: Array<{ pitch: number; start: number; duration: number; velocity: number }>,
  ) => void
  updateNote: (trackId: string, noteId: string, changes: Partial<Note>) => void
  removeNote: (trackId: string, noteId: string) => void
  selectNote: (noteId: string | null) => void
  previewNote: (pitch: number) => void
  addTrack: () => void
  removeTrack: (trackId: string) => void
  selectTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  setInstrument: (trackId: string, instrumentId: InstrumentId) => void
  toggleMute: (trackId: string) => void
  setProjectName: (name: string) => void
  newProject: () => void
  loadDemo: () => void
  saveProject: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  importMidi: (bytes: ArrayBuffer, name?: string) => void
  exportMidi: () => Uint8Array
  exportMusicXml: () => string
  importMusicXml: (xml: string, name?: string) => void
  exportProjectFile: () => string
  importProjectFile: (text: string, name?: string) => void
  exportWav: () => Promise<Uint8Array | null>
  shareSnapshot: () => ShareSnapshot
  formats: FormatContribution[]
  exportFormat: (id: string) => string | Uint8Array | null
  importFormat: (id: string, data: string, name?: string) => void
}
