# Composer API contract

This is the stable surface the composer feature cluster builds against: live
collaboration (#9) is the foundation, the current composer controller is
formalized as a frozen core API, and efforts #41–#45 add typed extension seams
without breaking the serialized `Project` shape. The contract is exported from
`composer/contract`; the current `COMPOSER_CONTRACT_VERSION` is `1.4.0`.

## Stability & versioning

`apps/web/src/composer/contract/` is the published package boundary:

| File | Tier | Role |
|---|---|---|
| `index.ts` | Stable | Barrel export plus `COMPOSER_CONTRACT_VERSION` |
| `core.ts` | Stable | Re-exports the current model/store/audio/hook/plugin surface and defines `ComposerPublicApi` |
| `conformance.ts` | Stable | Forward-only proof that `ComposerController` satisfies `ComposerPublicApi`, plus public/internal boundary guards |
| `collaboration.ts` | Provisional | Effort #9 public collaboration status plus internal provider/session classification |
| `instruments.ts` | Provisional | Effort #41 preset/sound-design seam over Plugin SDK instruments |
| `onboarding.ts` | Provisional | Effort #42 templates, tours, and first-run state |
| `platform.ts` | Provisional | Effort #43 viewport, PWA, offline-cache, and store decorator seam |
| `mixing.ts` | Provisional | Effort #44 mixer overlay, inserts, and automation seam |
| `ai.ts` | Provisional | Effort #45 extended AI actions, gating, and mastering seam |
| `export.ts` | Provisional | Effort #72 audio-export watermark entitlement seam |

Versioning follows semver:

- **Minor**: additive seams, new exported types, or new optional fields in a
  provisional effort file or the versioned `Project` document.
- **Major**: any change to the frozen `ComposerPublicApi` shape or a breaking
  change to stable core re-exports.

`ComposerPublicApi` is intentionally hand-written rather than aliased. The
conformance module is deliberately **forward-only**:

```ts
type ControllerImplementsContract = ComposerController extends ComposerPublicApi ? true : never
export const controllerImplementsContract: ControllerImplementsContract = true

type PublicApiExcludesCollabInternals =
  'applyRemoteProject' extends keyof ComposerPublicApi ? never : true
export const publicApiExcludesCollabInternals: PublicApiExcludesCollabInternals = true
```

Forward conformance means the live controller must provide every public member
with a compatible type; it also rejects hallucinated or mistyped contract members
because anything absent from the controller breaks the check. It is not an
exact-match proof because the controller may carry **internal** members after #9
lands, such as `applyRemoteProject`, that the public contract deliberately omits.
A bidirectional check would fail as soon as this contract rebases on top of #9.
`publicApiExcludesCollabInternals` separately fails `tsc` if known collaboration
sync plumbing leaks into `ComposerPublicApi`.

| Stability tier | What it includes | Compatibility promise |
|---|---|---|
| **Stable** | Core re-exports, `ComposerPublicApi`, `UseComposerOptions`, store/audio/model/plugin types | Safe for feature code to import directly; breaking changes require a major bump |
| **Provisional** | Per-effort seams for #9 and #41–#45 | Additive and typed now; shapes may still change until each effort lands |
| **Internal** | Anything not exported from `composer/contract` | No compatibility promise; do not import from feature code |

## The frozen surface (`ComposerPublicApi`)

`useComposer()` returns the controller components and plugins already use. The
contract freezes that controller as `ComposerPublicApi` so features can depend on
one public shape instead of reaching into React, reducers, storage, or Tone.js.

| Concern | Members | Purpose |
|---|---|---|
| State and selection | `state`, `project`, `selectedTrackId`, `snap`, `setSnap`, `savedProjects`, `status`, `audioReady`, `notify` | Read the current composer snapshot, grid, saved-project list, and status region |
| Transport | `transportState`, `positionBeats`, `play`, `pause`, `stop`, `togglePlay`, `setTempo`, `toggleLoop` | Control playback and loop/tempo state through the injected engine |
| Note editing | `addNoteAt`, `insertNotes`, `updateNote`, `removeNote`, `selectNote`, `previewNote` | Route edits through reducer validation and audition notes through the active engine |
| Tracks | `addTrack`, `removeTrack`, `selectTrack`, `renameTrack`, `setInstrument`, `toggleMute` | Manage track identity, names, instrument ids, selection, and mute state |
| Project lifecycle | `newProject`, `loadDemo`, `saveProject`, `loadProject`, `setProjectName` | Create, open, save, and name projects through the active `ProjectStore` |
| Import/export | `importMidi`, `exportMidi`, `importMusicXml`, `exportMusicXml`, `importProjectFile`, `exportProjectFile`, `exportWav`, `formats`, `exportFormat`, `importFormat` | First-class MIDI/MusicXML/project/WAV paths plus plugin-contributed formats |
| Sharing | `shareSnapshot` | Produce a URL or file share snapshot from the current project |

The hook is testable because its side-effect seams are injectable through
`UseComposerOptions`:

| Option | What it replaces |
|---|---|
| `store` | Persistence backend implementing `ProjectStore` |
| `createEngine` | Audio engine factory (`ToneAudioEngine`, `SilentAudioEngine`, or a mock) |
| `initialProject` | Initial project, bypassing restore/share-link bootstrapping |
| `autosaveDelay` | Debounced autosave delay; `0` makes save synchronous for tests |
| `audioRenderer` | Offline renderer used by WAV export |
| `watermarkExports` | Entitlement-derived WAV watermark flag |

## Persistence & audio seams

`ProjectStore` is async by design:

| Method | Role |
|---|---|
| `save(project)` | Insert or update a project and return `StoredProjectMeta` |
| `load(id)` | Load a project, or `null` for absent/corrupt data |
| `list()` | Return project metadata, newest first |
| `remove(id)` | Delete a project |
| `loadLast()` / `setLast(id)` | Restore and record the autosave/open target |

The shipped implementations are `LocalStorageProjectStore`, `RemoteProjectStore`,
and `SyncingProjectStore`. `SyncingProjectStore` routes to local storage while
signed out and to the remote store while signed in; `syncLocalToRemote()` uploads
local projects when the server copy is missing or older, using last-writer-wins
comparison by `updatedAt`.

`AudioEngine` isolates playback from editing. The default factory returns
`ToneAudioEngine` when Web Audio exists and `SilentAudioEngine` in SSR, tests, or
headless contexts. Features should depend on `AudioEngine` and `TransportState`
(`'stopped' | 'playing' | 'paused'`), not on Tone. The hook pushes each project
change into `engine.setProject()`, while note previews and transport controls stay
behind the same interface.

## Extension seams

### #9 Collaboration

What it builds on: `Project`, `ProjectStore`, and the frozen controller. Live
collaboration is the foundation seam: durable edits converge into a shared
project, while presence/awareness stays separate from `Project`. Persistence
continues to flow through `ProjectStore`.

| Type | Purpose | Tier |
|---|---|---|
| `ShareRole` | Role union: `owner`, `editor`, `viewer` (mirrors #9's server-authoritative `CollaborationRole`) | PUBLIC |
| `Participant` | Read-only projection of one `CollabPresence` entry: per-connection `id`, `userId`, `displayName`, `color`, `isSelf`, optional `role` | PUBLIC |
| `CollaborationStatus` | Read-only collaboration model features consume (`canShare`, `isActive`, `role`, `participants`) | PUBLIC |
| `selectCollaborationStatus` | Contract-owned read-only selector: projects #9's `CollaborationState` → `CollaborationStatus` | PUBLIC |
| `projectParticipant` | Projects one `CollabPresence` roster entry → `Participant` | PUBLIC |
| `useCollaborationStatus` | Zero-arg React hook — the feature-facing read; returns the status the nearest `<Composer>` publishes via context | PUBLIC |
| `CollaborationStatusContext` | React context `<Composer>` publishes the projected status through (features read via the hook) | PUBLIC |
| `ComposerCollaborationInternals` | Classification marker for #9 sync plumbing that must stay out of `ComposerPublicApi` | INTERNAL |

#### Public vs internal — collaboration surface

#9 merged first; this contract and the feature PRs rebase on top. The single-model
rule (agreed with #9): **this contract owns the PUBLIC shape and the read-only selector
that projects #9's internal live state into it — one type, no duplicate, no mutation
path.**

**PUBLIC (features #41/#42/#43/#45 may depend on these):**

- `canShare` — capability flag (mirrors the `<Composer canShare>` prop).
- `CollaborationStatus` — read-only model in `contract/collaboration.ts`:
  `{ readonly canShare: boolean; readonly isActive: boolean; readonly role: ShareRole; readonly participants: readonly Participant[] }`.
  The **only** collaboration surface features should consume.
- `Participant` — a read-only projection of one `CollabPresence` entry. `id` is a
  **per-connection** presence handle (stringified Yjs `clientId`), so one user in two
  tabs appears twice — group by `userId` for a per-person view. `isSelf` marks the local
  connection. `role` is **optional** (see below).
- `selectCollaborationStatus(state, { role, canShare }): CollaborationStatus` — the
  contract-owned read-only **projection primitive** (in `contract/collaborationSelector.ts`),
  a pure function over #9's `CollaborationState` (from `useCollaboration()`). Added in the
  post-#9 rebase; `<Composer>` composes it with the state, `collab?.role`, and the
  `canShare` prop it already carries — **no #9 change required**.
- `useCollaborationStatus(): CollaborationStatus` — the **feature-facing read** (in
  `contract/collaborationContext.ts`). A zero-arg React hook returning the status the
  nearest `<Composer>` publishes through `CollaborationStatusContext`, or the solo default
  outside one. `<Composer>` computes the value once with `selectCollaborationStatus` over
  its **single** `useCollaboration()` instance and provides it via context; features
  (#41/#44/#45) call the hook and **never** call `useCollaboration()` themselves. This
  single-source rule is load-bearing: a second `useCollaboration()` call would open a
  duplicate relay/awareness session and double the local user in presence. The Composer-side
  Provider wrap is #9's additive fast-follow (merged after this contract, base unchanged);
  until it lands the hook safely returns the solo default, so this contract stays green
  independently.

Projection mapping (#9 internal → contract public):

| Contract (`CollaborationStatus` / `Participant`) | #9 source (`CollaborationState` / `CollabPresence`) |
|---|---|
| `isActive` | `active` |
| `role` (current user) | current user's server-authoritative role |
| `participants` | `presence` projected to `Participant[]` |
| `Participant.id` | `String(clientId)` (per-connection) |
| `Participant.userId` | `user.id` |
| `Participant.displayName` | `user.name` |
| `Participant.color` | `user.color` |
| `Participant.isSelf` | `isSelf` |
| `canShare` | `<Composer canShare>` capability prop |

#9's internal `connected` / `canWrite` and per-participant `cursor` are **not** part of
the public surface.

**Per-participant `role` is optional in v1.** #9's awareness broadcasts only the current
user's role (surfaced at `CollaborationStatus.role`), not each peer's, so `Participant.role`
is omitted for peers. When a feature needs per-peer role badges, #9 adds a self-reported
role to awareness as an additive fast-follow. **Security:** a self-reported awareness role
is a **display hint only** and MUST NOT gate behavior — write access is enforced
server-side by #9's relay (viewers' write-frames are dropped before broadcast), never by
this field.

**INTERNAL (features MUST NOT depend on / drive these — collab plumbing):**

- `ComposerController.applyRemoteProject(project)` — applies a remote Yjs snapshot.
- `ComposerAction` variant `'sync-remote'` — the reducer action backing the above.
- `<Composer collabProviderFactory>` prop — provider wiring.
- `useCollaboration(): CollaborationState` + `CollabPresence` (in
  `composer/model/collab/`) — #9's live-state hook and roster; the source the public
  projection derives from. Features consume `CollaborationStatus`, not these.

`contract/collaboration.ts` exports `ComposerCollaborationInternals` purely as a
classification marker, and `contract/conformance.ts` enforces the boundary at compile
time (`'applyRemoteProject'` must never be a key of `ComposerPublicApi`). Post-#9,
`contract/collaborationSelector.ts` adds the tightening binding: it imports #9's real
`CollaborationState` / `CollabPresence` and exports compile-time proofs
(`rolesAligned`, `presenceProjectsToParticipant`, `selectorConformsToContract`) that
bind #9's live shape to the contract (`⊆`: the contract owns the public shape and #9
conforms to it, never the reverse). If #9's live-state fields drift, that file stops
compiling.

```ts
// Feature panels (#41/#44/#45) render inside <Composer> and read the hook — no props,
// no useCollaboration() call, no double-connect:
function CollaborationBadge() {
  const status = useCollaborationStatus() // zero-arg, single-source
  setShareDisabled(!status.canShare)
  renderParticipants(status.participants) // each has id, userId, displayName, color, isSelf

  // INTERNAL — do NOT call: controller.applyRemoteProject(...) / useCollaboration(...)
  return status.isActive ? `Live as ${status.role}` : 'Solo'
}
```

### #41 Instrument presets

What it builds on: the Plugin SDK `InstrumentContribution` and the open
`InstrumentId` string. Presets are opaque serializable parameter bags owned by
the contributing instrument; the contract does not interpret their params.

| Type | Purpose |
|---|---|
| `InstrumentEngineKind` | Engine family: `synth`, `sampler`, or `soundfont` |
| `InstrumentPreset` | Named param bag for one instrument id |
| `PresetBrowserEntry` | Browser row pairing a preset with its instrument definition |
| `InstrumentPresetContribution` | Plugin-owned preset list keyed by instrument contribution id |
| `SoundDesignInfo` | Optional engine/sample/polyphony metadata |

```ts
function applyPreset(api: ComposerPublicApi, preset: InstrumentPreset) {
  api.setInstrument(api.selectedTrackId, preset.instrumentId)
  savePresetParams(api.selectedTrackId, preset.params)
  api.notify(`Loaded ${preset.name}`)
}
```

### #42 Onboarding

What it builds on: `Project` factories (`createEmptyProject`, `createDemoProject`)
and Plugin SDK command ids. Templates create projects; tour actions point at
registered commands rather than bespoke UI callbacks.

| Type | Purpose |
|---|---|
| `ProjectTemplate` | First-run project factory with category metadata |
| `OnboardingStep` | Guided-tour copy, anchor, and optional command action id |
| `OnboardingTour` | Ordered list of onboarding steps |
| `FirstRunState` | Local completion/dismissal checkpoint |

```ts
function startTemplate(api: ComposerPublicApi, template: ProjectTemplate) {
  const project = template.create()
  api.importProjectFile(JSON.stringify(project), project.name)
  api.notify(`Started ${template.name}`)
}
```

### #43 Platform, PWA, and offline

What it builds on: the async `ProjectStore` seam and existing syncing behavior.
Viewport, install prompts, and offline status are local/platform concerns; they
do not become durable project fields.

| Type | Purpose |
|---|---|
| `ViewportKind` | Coarse layout bucket: `mobile`, `tablet`, or `desktop` |
| `ComposerViewport` | Layout metrics and pointer mode for responsive composer UI |
| `OfflineStatus` | Online/offline/syncing state |
| `OfflineCacheState` | Pending sync count and last sync timestamp |
| `PwaInstallState` | Install affordance state |
| `PwaController` | Browser install prompt wrapper |
| `OfflineProjectStore` | Alias for `ProjectStore` used by offline decorators |
| `KeyboardPlatform` | Mac-family versus Ctrl/Alt keybinding labels |
| `PlatformCapabilities` | Observable viewport, available/primary pointer, install, connectivity, and browser API facts |
| `PlatformCapabilitySource` | SSR-safe injectable snapshot/subscription seam |

The browser implementation and PWA behavior are documented in
[`platform-pwa.md`](platform-pwa.md). These are additive runtime contracts;
viewport and platform facts remain outside durable project data.

```ts
function offlineBadge(cache: OfflineCacheState, viewport: ComposerViewport) {
  if (cache.status === 'online') return null
  const label = `${cache.pendingSync} pending`
  return viewport.kind === 'mobile' ? label : `Offline — ${label}`
}
```

### #44 Mixing and automation

What it builds on: `Track.id`, `Track.muted`, and Plugin SDK
`EffectContribution`. Mixer state is an overlay keyed by track id; it does not
add fields to `Track`. `TrackMixerState.muted` mirrors `Track.muted`, which
remains the single source of truth. Inserts reuse effect contributions.

| Type | Purpose |
|---|---|
| `TrackMixerState` | Per-track gain, pan, solo, and mirrored mute state |
| `MasterBusState` | Master gain and limiter controls |
| `MixerSnapshot` | Full overlay snapshot keyed by track id plus master state |
| `TrackInsert` | Per-track effect insert with durable numeric params |
| `MixerController` | Read/update API for mixer controls, inserts, and live insert params |
| `AutomationPoint` | Beat/value point |
| `AutomationLane` | Automation target and ordered point list |
| `MixerEffectNode` | Effect-node alias for mixer audio graph reuse |
| `EffectContribution` / `EffectNode` | Re-exported Plugin SDK effect surface with optional parameter descriptors and live updates |

```ts
function syncMute(api: ComposerPublicApi, mixer: MixerController) {
  const trackId = api.selectedTrackId
  api.toggleMute(trackId)
  const muted = api.project.tracks.find((t) => t.id === trackId)?.muted ?? false
  renderMixer({ ...mixer.getSnapshot().tracks[trackId], muted })
}
```

**Implemented by** (effort #44): the mixer UI consumes this contract through
`composer/hooks/useMixer.ts` and `composer/components/MixerPanel.tsx`, backed by
`composer/audio/mixerController.ts` (state overlay + inserts + automation) and
`composer/audio/mixerGraph.ts` (the Tone audio graph). The insert palette —
parametric EQ, studio reverb, tempo delay, and glue compressor — ships as
`composer/plugins/builtins/mixEffects.ts` `EffectContribution`s, all
`enabledByDefault: false` so the stock signal path stays transparent. The
controller wires into the audio engine additively; the default overlay (0 dB,
center pan, limiter off) is unity, and note preview routes past the mixer so
auditions remain audible. Composer contract `1.4.0` adds numeric
`EffectParameterDescriptor`s, factory `EffectContext.params`, optional
`EffectNode.updateParams`, and `MixerController.setInsertParams`. The mixer
renders controls only for validated descriptors registered by an active plugin.
Edits clamp to descriptor bounds, update live nodes, persist in
`ProjectMixInsert.params`, and coalesce each pointer/keyboard gesture into one
undo step. Factory creation, hydration, same-structure updates, and the public
controller setter all share one complete-snapshot normalizer: missing values
receive defaults, values clamp and snap to the descriptor step, and invalid
types fall back safely. Effects that omit descriptors keep their original fixed
behavior. Tone-backed and silent/headless engines install the same contribution
resolver, so normalization is identical without constructing Web Audio nodes.
Externally returned insert views deep-clone parameter records; cached subscribed
views freeze them so consumer mutation cannot alter controller state.
Parameter actions carry one id/value change and merge against the reducer's
current document, so multiple controls edited in one React tick cannot overwrite
each other.

### #45 Extended AI

What it builds on: the current `CompositionAssistant`, `AssistantSuggestion`, and
server-authoritative `Entitlements`. Gating must read
`Entitlements.aiGenerationsPerDay`; do not create a parallel entitlement model.
The `auto-master` action emits a `MasteringSuggestion` targeting the mixer
overlay, not raw audio.

| Type | Purpose |
|---|---|
| `ExtendedAssistantAction` | Current actions plus text, style, groove, and auto-master actions |
| `TextPromptRequest` | Text-to-motif request with prompt and generation params |
| `StyleTransferRequest` | Style-transfer request seeded by suggested notes |
| `MasteringSuggestion` | Mixer/master gain and limiter recommendation |
| `AiEntitlementView` | Entitlement adapter for usage checks and remaining generations |
| `ExtendedCompositionAssistant` / `ExtendedAssistantSuggestion` | Aliases for existing assistant seams |

```ts
function canRunAi(view: AiEntitlementView, entitlements: Entitlements) {
  if (!view.canUse('text-to-motif', entitlements)) return false
  return view.remainingGenerations(entitlements, usedToday()) > 0
}
```

### #72 Audio-export watermark

What it builds on: the server-authoritative `Entitlements.watermarkExports` flag
and the pure `audioWatermark` renderer already applied at the WAV render→encode
boundary. Gating must read `Entitlements.watermarkExports`; do not create a
parallel entitlement model. The view only decides *whether* an export is
watermarked — free (or any unknown/malformed entitlement) stays watermarked, and
only a resolved paid entitlement that clears the flag exports clean.

| Type | Purpose |
|---|---|
| `ExportAction` | Audio export actions whose output is watermark-gated (currently `wav`) |
| `ExportEntitlementView` | Entitlement adapter deciding whether an export carries the free-tier watermark |

```ts
function watermarkFor(view: ExportEntitlementView, entitlements: Entitlements) {
  return view.appliesWatermark('wav', entitlements)
}
```

## Integration notes & open decisions (cross-cluster)

The contract defines the API surface and schema v3 adds an optional, sanitized
`Project.mix` document for manual track and master settings.

- **Durable/shared (converges via #9 CRDT):** score fields, mixer/inserts/master,
  effect params, and accepted AI note edits.
- **Durable/local-only in collaboration:** automation persists through project
  files, stores, and share snapshots but is not yet carried by the CRDT.
- **Awareness/ephemeral:** presence, peer cursors, selections, AI preview ghosts,
  and other room-local overlays.
- **Local-only:** onboarding progress, viewport/touch mode, PWA install state,
  and offline status.

Place each new field in the right tier before wiring UI or persistence.

The mixer overlay survives reload, project-file export, stores, and share
snapshots through schema v3 `Project.mix`. Unavailable plugin effect ids are
retained with their numeric params and bypassed until their provider becomes
available again. The nested CRDT mix map converges per track/insert/parameter and
is covered by the collaboration `Y.UndoManager`, so parameter gestures remain
undoable while collaborating. Automation remains collaboration-local.

`model/persistence.ts` currently hardcodes `['poly-synth', 'fm-synth',
'drum-kit']` and coerces unknown `instrumentId` values to `poly-synth`. #41 must
preserve unknown ids in data and degrade only at playback/UI resolution; otherwise
plugin instruments are silently erased on round-trip.

The current whole-project debounced autosave is last-writer-wins. While a
collaboration room is connected, that autosave must yield to CRDT-owned
persistence. #9 and #43 need explicit reconnect/offline replay semantics.

Notes, AI ghosts (#45), automation lanes (#44), peer cursors (#9),
caret/playhead, and touch targets (#43) all compete for the piano roll. Parallel
feature work needs a shared layering and hit-testing plan before implementation
details diverge.

#9 (`collaborationSeats`) and #45 (`aiGenerationsPerDay`) should share one
locked/pro UI pattern. The client can shape affordances, but the server remains
authoritative.

## Consuming the contract

Import from the contract barrel, not from internal implementation paths:

```ts
import type {
  CollaborationStatus,
  ComposerPublicApi,
  InstrumentPreset,
  MixerController,
  Participant,
} from '../composer/contract'
```

Feature-author checklist:

- Import public types and helpers from `composer/contract`; avoid internal files.
- Treat `ComposerPublicApi` and core re-exports as stable.
- Treat effort files as provisional until their feature lands.
- Keep changes additive unless intentionally scheduling a major contract bump.
- Put new durable/shared state behind the persistence-envelope decision.
- Keep awareness and local-only state out of serialized `Project`.
- Consume collaboration through `CollaborationStatus`; never call #9 sync internals.
- Reuse `ProjectStore`, `AudioEngine`, Plugin SDK, and `Entitlements` seams.
- Run typecheck; `contract/conformance.ts` guards the frozen surface.
