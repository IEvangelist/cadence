# Import / export / share & format interop

Cadence composer projects are portable. Everything below is **client-side only** —
no server, no account, no network. It works offline and in the Tauri desktop shell.

All format code lives in [`apps/web/src/composer/formats`](../apps/web/src/composer/formats)
and is wired into the toolbar through the `useComposer` controller. Each format has a
round-trip unit test, and an end-to-end smoke exercises export → re-import in the
browser (`apps/web/e2e/composer.spec.ts`).

## Formats

| Format | Direction | Extension | Library | Notes |
|---|---|---|---|---|
| **MusicXML** | export + import | `.musicxml` | hand-rolled (`DOMParser`/serialization, no new dep) | `score-partwise` subset. Round-trips pitch/start/duration + tempo for grid-aligned notes. |
| **Audio (WAV)** | export | `.wav` | `tone` 15.1.22 (already in the app) + hand-rolled PCM-16 encoder | Offline render via `Tone.Offline`. Lossless 16-bit RIFF/WAVE. |
| **Portable project** | export + import | `.cadence.json` | hand-rolled JSON envelope | Full versioned project model; reuses the persistence `migrateProject` seam. |
| **MIDI** | export + import | `.mid` | `@tonejs/midi` (pre-existing) | Unchanged; kept for backward compatibility. |

**No new runtime dependencies were added.** MusicXML, WAV, the portable file, and
share are all hand-rolled; audio reuses the existing `tone` engine. This keeps
`package-lock.json`, the npm-audit surface, and the CI workflows untouched.

### MusicXML

`projectToMusicXml` / `musicXmlToProject` in
[`musicxml.ts`](../apps/web/src/composer/formats/musicxml.ts).

- 4/4 measures, `divisions = 480` (matches the model's default PPQ).
- Notes that cross a barline are split into tied segments (`<tie>` + `<tied>`), and
  merged back on import.
- Chords (`<chord/>`) share the previous note's start.
- **Velocity is not represented.** MusicXML is a notation format with no per-note
  performance velocity, so imported notes are restored to the model default (0.8).
  Pitch, start, duration, and tempo round-trip exactly for grid-aligned input. This
  matches the issue's "round-trip notes + tempo where practical" guidance.
- Malformed input throws a typed `MusicXmlImportError`, surfaced in the UI as a
  friendly status (mirrors the existing `MidiImportError` pattern).

### Audio (WAV)

[`audioExport.ts`](../apps/web/src/composer/formats/audioExport.ts) splits the work so
it is fully testable without Web Audio:

- `encodeWav(channels, sampleRate)` is a **pure** PCM-16 RIFF/WAVE encoder.
- `renderProjectToWav(project, { renderOffline })` orchestrates *render → encode*.
  The offline renderer is **injected**; the default binds to `Tone.Offline`
  ([`audio/offlineRender.ts`](../apps/web/src/composer/audio/offlineRender.ts)), while
  unit tests pass a tiny mock so the path runs under jsdom/CI.

The render duration is derived from the last sounding beat plus a release tail so
note tails aren't clipped. `offlineRender.ts` is excluded from coverage (Web Audio
can't run under jsdom) and is lazy-imported, so it only loads when a WAV is exported.

**MP3 is intentionally not shipped.** There is no well-maintained, exact-pinned,
pure-JS MP3 encoder to adopt, so WAV (lossless) is the audio export format. The
encoder seam (`RenderWavOptions`) leaves room to add one later without touching
callers.

### Portable project file (`.cadence.json`)

[`projectFile.ts`](../apps/web/src/composer/formats/projectFile.ts) wraps the project
model in a small versioned envelope:

```json
{ "format": "cadence-project", "version": 1, "schemaVersion": 1,
  "exportedAt": "…ISO…", "project": { /* full Project model */ } }
```

Import runs the project through the same `migrateProject` seam used by localStorage
persistence, so older files are coerced/migrated forward. Malformed input throws a
typed `ProjectFileError`.

## Share (client-side)

The **Share** button produces a portable snapshot with no backend
([`share.ts`](../apps/web/src/composer/formats/share.ts)):

1. **Shareable link (small projects).** The project is encoded as base64url JSON into
   a `#project=…` URL fragment and copied to the clipboard. Opening that URL restores
   the project on mount (the fragment is decoded, loaded, and then cleared from the
   address bar). The fragment never hits a server — it lives entirely in the URL.
2. **File fallback (large projects).** When the encoded URL would exceed
   `MAX_SHARE_URL_LENGTH` (8000 chars), Share downloads the `.cadence.json` file
   instead and tells the user to share the file.

This satisfies the "portable sharing" requirement without any server, auth, or
storage.

## Follow-up: hosted share links

A **hosted, server-backed share link** (a short URL that opens a read-only view of a
project stored on the server) builds on the projects API and server storage delivered by
identity/persistence ([#7](https://github.com/IEvangelist/cadence/issues/7), now
shipped). The hosted variant itself is a **follow-up** and is not built yet — the
client-side share above is the complete, shipped behavior.

### Intended contract (when it's built)

The client already has a clean seam: `createShareSnapshot` returns a discriminated
union today (`{ kind: 'url' }` | `{ kind: 'file' }`). Hosted links add a third arm
without changing existing callers:

```ts
// Future addition on top of the projects API — NOT implemented here.
type HostedShareSnapshot = { kind: 'hosted'; url: string; id: string }
```

Proposed API surface:

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /api/shares` (body: project) → `{ id, url }` | Publish a read-only snapshot | Owner |
| `GET /api/shares/{id}` → project | Fetch a shared snapshot | Public/read-only |
| `DELETE /api/shares/{id}` | Revoke a share | Owner |

Client work when it's built (small, additive):

- Add a `publishShare(project)` method to the controller that calls `POST /api/shares`
  and returns a `HostedShareSnapshot`.
- Extend the toolbar Share affordance with a "Create link" option that falls back to
  the current URL-fragment/file behavior when the user is offline or signed out.

Until then, the URL-fragment + file share above is the complete, shipped behavior.
