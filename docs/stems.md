# Stem separation (effort #10, Phase 1)

Cadence can split an uploaded mix into isolated **stems** — bass, drums, vocals,
guitar, keys, synth, and everything else — through an authenticated, owner-scoped,
asynchronous job pipeline. This document covers the Phase 1 surface: the API, the
background worker, the separation model (pin + provenance + license), entitlement
gating, and the standalone web UI.

> **Scope.** Phase 1 ships server-side separation, the async job pipeline, and a
> **standalone** preview/download UI under `apps/web/src/stems/`. Turning a
> separated stem into an editable mixer **track inside the composer** is a Phase 2
> follow-up and is intentionally **not** wired into the composer here.

## Flow at a glance

```
 Web (apps/web/src/stems)                API (src/Cadence.Api)            Worker (src/Cadence.SeparationWorker)
 ─────────────────────────               ─────────────────────            ────────────────────────────────────
 POST /api/stems/jobs  ───────────────▶  entitlement gate (402 free)
   (raw audio body)                      validate type/size/duration
                                         persist SeparationJob (Queued)
                                         store mix in Blob
                                         202 + job JSON  ◀──────────────
 poll GET /api/stems/jobs/{id} ───────▶  owner-scoped read (404 on IDOR)
                                                                          claim next Queued job
                                                                          download mix from Blob
                                                                          separate → 7 labeled stems
                                                                          store stems in Blob
                                                                          mark Completed
 GET .../stems/{label}  ──────────────▶  owner-scoped stream from Blob
```

Everything is **owner-scoped**: `SeparationJob` uses a composite key
`{OwnerId, Id}` (and `SeparationStem` uses `{OwnerId, JobId, Label}`), mirroring
the `ProjectEntity` pattern. Every job and stem read filters by the caller's id,
so a cross-owner id returns `404` (no IDOR).

## API

All routes require authentication (the hardened `HttpOnly` session cookie) and are
owner-scoped.

| Method | Route | Behavior |
|---|---|---|
| `POST` | `/api/stems/jobs?name={fileName}` | Upload a mix as the **raw request body** (no multipart). Creates a `Queued` job. `202` + job JSON. |
| `GET` | `/api/stems/jobs` | List the caller's jobs (newest first), without stems. |
| `GET` | `/api/stems/jobs/{id}` | Read one job with its stems (once `Completed`). |
| `GET` | `/api/stems/jobs/{id}/stems/{label}` | Stream one stem's audio from Blob. |

**Validation** (in order, first failure wins):

1. **Entitlement** — not `StemSeparation` → `402 application/problem+json`.
2. **Content type** — media type not in `Stems:AllowedContentTypes` → `415`.
3. **Size** — body over `Stems:MaxUploadBytes` (default 50 MB) → `413`.
4. **Empty** — zero-length body → `400`.
5. **Duration** — decoded WAV longer than `Stems:MaxDurationSeconds` (default
   600 s) → `413`.

**Stem labels** (fixed catalog, in this order): `bass`, `drums`, `vocals`,
`guitar`, `keys`, `synth`, `other`.

**DTOs** (System.Text.Json web defaults → camelCase on the wire):

- `StemJobSummary { id, status, originalFileName, sizeBytes, createdAt, updatedAt, completedAt }`
- `StemInfo { label, sizeBytes, url }` where `url` is the server-relative stem download route
- `StemJobDetail { id, status, originalFileName, contentType, sizeBytes, createdAt, updatedAt, completedAt, errorMessage, stems }`

`status` is one of `Queued`, `Processing`, `Completed`, `Failed`.

## Entitlement gating (Pro-only)

Stem separation is gated on the `StemSeparation` entitlement flag reserved by the
#8 billing work (`IEntitlementService` / `EntitlementOptions`). The API resolves
the caller's tier **from the database profile**, not the cookie, and free users
get `402` with an `application/problem+json` body whose `type` matches the
existing `/api/projects` over-cap 402 (`UpgradeRequiredType`), so the SPA can
route to the upgrade CTA. The web UI mirrors the gate on the `useEntitlements`
hook for UX only — the server remains authoritative.

## Async job pipeline

- **`SeparationJob`** / **`SeparationStem`** entities + `JobStatus` enum live in
  `src/Cadence.Data/Stems` and are additive EF migration `AddStemSeparation`.
- **`SeparationJobStateMachine`** encodes the legal transitions
  (`Queued → Processing → Completed | Failed`) as pure, unit-tested functions.
- **`SeparationJobProcessor`** claims the next `Queued` job, downloads the mix,
  runs the configured `IStemSeparator`, writes each labeled stem via
  `IStemStorage`, and advances the state machine — persisting `Failed` with an
  error message if separation throws.
- **`Cadence.SeparationWorker`** hosts a `BackgroundService` loop (2 s poll, 5 s
  error backoff) that drives the processor. It is wired into the Aspire graph as
  the `separation` resource with references to the already-provisioned
  `cadencedb` (Postgres) and `blobs` (Azure Blob / Azurite in dev).

## Separation model — pin, provenance, and license

Cadence uses an **open, permissively licensed** model.

| | |
|---|---|
| **Model** | Demucs v4 (`htdemucs`) — hybrid transformer Demucs |
| **Source** | [`facebookresearch/demucs`](https://github.com/facebookresearch/demucs) |
| **License** | **MIT** (permissive) |
| **Native sources** | 4 (`drums`, `bass`, `other`, `vocals`) |
| **Runtime** | ONNX Runtime (`Microsoft.ML.OnnxRuntime` **1.28.0**, pinned in `Directory.Packages.props`) |
| **Execution** | GPU (CUDA) when available, automatic **CPU fallback** (the base ONNX Runtime package is CPU-only, so the CUDA provider registration is attempted and gracefully falls back) |

**How the extended 7-label catalog is produced.** Demucs natively emits four
sources. Cadence keeps `bass`, `drums`, and `vocals` directly, and derives
`guitar`, `keys`, `synth`, and `other` from the residual "other" source via the
deterministic `BandSplitStemSeparator` — so the labeled catalog is stable while
still using a real, open model for the hard vocal/drum/bass isolation.

**Pinning & provenance.** The model **binary is never committed**. Only its
**pinned URI** is configured (`Stems:ModelUri`), and its version, source, and
license are documented here. At runtime `HttpStemModelProvider` fetches the model
once and caches it under the local application-data directory, keyed by a hash of
the URI (so changing the pin re-downloads). A `file://`/local path is used in
place. In production the pinned ONNX export is expected to live in Blob storage;
fetch-and-cache keeps large binaries out of git and out of the container image.
If a container image is used for the worker, pin it **by digest**
(`@sha256:…`), never a floating tag.

**Default engine (CI/dev).** When `Stems:ModelUri` is **unset** — the default in
CI and local dev — the worker uses the deterministic `BandSplitStemSeparator` for
**all** labels. This is a real DSP band-split (no network, no large binary), which
is what makes the Aspire integration test hermetic: it exercises the full
upload → job → separate → store → download lifecycle without downloading the model.
The ONNX engine is a drop-in `IStemSeparator` selected only when a model is pinned.

## Configuration (`Stems` section)

Nothing here is a secret; all values have safe defaults (see `StemOptions`).

| Key | Default | Meaning |
|---|---|---|
| `Stems:MaxUploadBytes` | `52428800` (50 MB) | Upload size cap (`413`). |
| `Stems:MaxDurationSeconds` | `600` | Mix duration cap (`413`). |
| `Stems:AllowedContentTypes` | WAV/MP3/FLAC/OGG/MP4/AAC | Accepted upload media types (`415`). |
| `Stems:ContainerName` | `stems` | Blob container for mixes + stems. |
| `Stems:ModelUri` | *(unset)* | Pinned ONNX model URI; unset → band-split engine. |

## Web UI (standalone)

The UI lives in its own area, `apps/web/src/stems/`, deliberately **separate from
the composer** (`apps/web/src/composer/**` is untouched):

- `stemsClient.ts` — a typed client mirroring `billing/entitlementsClient.ts`
  (injectable `fetch` + base URL, `credentials: 'include'`). Maps `402/413/415`
  to a typed `StemsError`.
- `StemsPage.tsx` — gates on `useEntitlements().stemSeparation`; shows an
  accessible upgrade CTA to free users; for entitled users, uploads a mix, polls
  job progress, and previews (`<audio controls>`) and downloads each stem.
- `stems.css` — brand-token themed, responsive.

It is reachable from a **Stems** button in the app nav (`App.tsx`). The page is
accessible (labelled region, heading hierarchy, `aria-live` progress, `role=alert`
errors) and axe-clean.

See [`testing.md`](testing.md) for the full test matrix and
[`billing-setup.md`](billing-setup.md) for the entitlement model.
