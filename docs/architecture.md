# Architecture

Condensed view. The authoritative roadmap is [`plan.md`](plan.md).

```
+------------------- Tauri Desktop Shell (Rust) -------------------+
|  TypeScript SPA (React + Vite)                                   |
|   - Composer canvas: piano roll, transport, mixer               |
|   - Audio engine: Tone.js / Web Audio; Web MIDI (webmidi.js)    |
|   - Notation: OpenSheetMusicDisplay (MusicXML) + VexFlow        |
|   - Multitrack mixer + isolated stem tracks                     |
|   - In-browser AI: Magenta.js + TensorFlow.js                   |
|   - Collab client: Yjs (CRDT) + awareness/presence             |
+------------------------------ HTTPS / WSS ----------------------+
                    |                         |
      +-------------v-----------+   +---------v-----------+
      |  Aspire AppHost         |   | Yjs collab relay    |
      |  - API (ASP.NET Core)   |   | (Node y-websocket)  |
      |    REST + OpenAPI       |   +---------------------+
      |    Identity + OAuth     |
      |    Entitlements/billing |   +---------------------+
      |  - Premium AI service   |   | Postgres | Redis |  |
      |    (Python/ONNX)        |   | Blob (Azurite dev) |
      |  - Stem-separation svc  |   +---------------------+
      |    (Demucs/ONNX)        |
      +-------------------------+
```

> **Shipped vs planned.** The API, Postgres, Redis, and Blob storage run today under
> the Aspire AppHost. The **premium AI service**, the **stem-separation worker**, and
> the **Yjs collaboration relay** shown above are planned/in-progress (see
> [`plan.md`](plan.md) → Phases 6–7) — they are not yet in `src/`. The shipped AI
> assistant runs **in the browser** (Magenta.js / TF.js), not server-side.

## Projects

| Path | Role |
|---|---|
| `apps/web` | TypeScript SPA (Vite + React) — the whole UI |
| `apps/desktop` | Tauri shell (Rust) wrapping the SPA |
| `src/*.AppHost` | Aspire orchestration |
| `src/*.ServiceDefaults` | Shared telemetry/resilience/health |
| `src/*.Api` | REST + OpenAPI, Identity, entitlements |
| `src/*.Data` | EF Core model, `CadenceDbContext`, migrations, entitlement seam |
| `src/*.AiService` *(planned)* | Premium symbolic AI (Python/ONNX) |
| `src/*.Separation` *(planned)* | Demucs/ONNX stem-separation worker |
| `tests/*` | unit / integration / e2e / a11y / security |
| `infra` | `azd` + IaC |

## Cross-cutting
Test-first (TDD) everywhere · OpenTelemetry via Aspire · OAuth + secret hygiene ·
GitHub Actions CI with SHA-pinned actions (see `versioning-policy.md`). The web
composer is extensible through a typed, in-process **Plugin SDK** — instruments,
effects, formats, AI providers, commands, and panels all register through one host
(see [`plugins.md`](plugins.md)).

## API reference (OpenAPI + Scalar)

`src/*.Api` exposes its REST surface as an OpenAPI document
(`Microsoft.AspNetCore.OpenApi`) and ships with an interactive
[**Scalar**](https://scalar.com/) reference UI rendered over it — the standard for
Cadence APIs.

| Route | Serves |
|---|---|
| `/openapi/v1.json` | The generated OpenAPI document |
| `/scalar` | The Scalar interactive API reference UI |

Both are enabled in **all environments by default** so the API always "ships with"
its reference. A single flag, **`ApiDocs:Enabled`** (bound from configuration,
default `true`), gates them. Operators set `ApiDocs__Enabled=false` (env var) or
`"ApiDocs": { "Enabled": false }` (config) to turn the docs off — for example in
production. Development works out of the box.

> **Production exposure tradeoff:** because the reference ships enabled everywhere,
> a public deployment exposes the full API surface at `/scalar` and
> `/openapi/v1.json` unless `ApiDocs:Enabled` is set to `false`. Leave it on where
> discoverability helps (internal/staging); turn it off on hardened public
> deployments that should not advertise their schema.

## Identity & persistence

Accounts use ASP.NET Core Identity (local password, passwordless magic link, and
GitHub/Google/Microsoft OAuth) backed by Postgres via EF Core (`src/*.Data`).
Sessions ride a hardened `HttpOnly` cookie; the API replies with status codes so
the SPA can react. Each user has a profile and a subscription **tier** claim
(default `Free`). Effort #8 makes the entitlement seam real: a Stripe-backed
subscription lifecycle drives the tier, which maps to a typed entitlement set
enforced server-authoritatively (over-limit/paid-only → `402`). Projects are
**owner-scoped**: the
`/api/projects` CRUD API filters by the caller's id (non-owner access → `404`).
The web composer keeps its existing persistence seam: signed out it uses the
versioned `localStorage` store (offline-first); on sign-in it syncs local-only
projects up and switches to the remote store. See
[`auth-setup.md`](auth-setup.md) and [`billing-setup.md`](billing-setup.md).

## Live collaboration

Effort #9 adds opt-in real-time co-editing. The composer project is bound to a
Yjs (CRDT) document so concurrent edits from multiple clients merge
deterministically and converge; remote updates are routed through the existing
`localStorage` sanitize seam before reaching the reducer. Presence (live
cursors/selections + roster) rides the Yjs awareness protocol.

The relay is a **first-party ASP.NET Core WebSocket endpoint** inside
`Cadence.Api` (`/api/collab/{projectId}`), not a container — authorization must
tie each connection *and each message* to the cookie identity (#7) and the
projects DB. Share links carry a server-persisted role (owner / editor /
viewer); role is resolved server-side and **viewer document-writes are dropped
at the message boundary** before fan-out, so read-only access is enforced
server-authoritatively (fail closed), never by the client. Collaboration is
inert unless a session is explicitly activated, so single-user behavior is
unchanged. See [`collaboration.md`](collaboration.md).

## Stem separation (effort #10, Phase 1)

Cadence splits an uploaded mix into isolated **stems** (bass, drums, vocals,
guitar, keys, synth, other) through an authenticated, owner-scoped, **asynchronous
job pipeline**. The `src/*.Api` surface (`/api/stems`) gates on the Pro-only
`StemSeparation` entitlement (free → `402`, tier read from the DB profile),
validates content-type/size/duration, persists an owner-scoped `SeparationJob`
(composite key `{OwnerId, Id}`, IDOR-safe like `ProjectEntity`), and stores the
mix in Blob. A dedicated **`src/Cadence.SeparationWorker`** — an Aspire `separation`
resource wired to the existing Postgres + Blob — runs a `BackgroundService` that
claims queued jobs, separates them, and writes labeled stems back to Blob for
owner-scoped download.

The separation model is **Demucs v4 (`htdemucs`, MIT)** run via ONNX Runtime
(GPU with CPU fallback); the model binary is fetched-and-cached at runtime (never
committed) and only its pinned URI/version/license is tracked. When no model is
pinned (CI/dev default) a deterministic band-split engine drives the same
`IStemSeparator` seam, keeping tests hermetic. Phase 1 ships a **standalone** web
surface (`apps/web/src/stems/`) — the composer integration (stem → editable mixer
track) is a Phase 2 follow-up. See [`stems.md`](stems.md).

### Stem pipeline hardening (effort #10, Phase 2)

Phase 2 (`#57`) hardens the pipeline for real deployment without changing its
surface. Jobs carry a **processing lease** (`ProcessingStartedAt`) and an
**attempt counter** (`Attempts`): a reaper in `SeparationJobProcessor` returns
lease-expired `Processing` jobs to `Queued` (or `Failed` once attempts are
exhausted), so a crashed worker no longer strands a job. Job claiming is now a
single conditional `UPDATE … WHERE Status = 'Queued'` (`ExecuteUpdateAsync`, the
`FOR UPDATE SKIP LOCKED` equivalent), so scaled-out worker replicas can never both
claim the same job. When a model is pinned, the download must be `https` and is
verified against a pinned SHA-256 (`Stems:ModelSha256`) before use, with a
corrupted cache purged and re-fetched. See [`stems.md`](stems.md).

## Local development (one-command `aspire run`)

`aspire run` brings up
the full local stack — Postgres, Redis, Azurite, the API, the stem-separation
worker — **and** the `apps/web` Vite/React SPA, so the developer-facing UI is one
command away (effort #79). The SPA is an Aspire **NodeJS** resource:

```csharp
builder.AddNpmApp("web", "../../apps/web", "dev")
    .WithReference(api).WaitFor(api)
    .WithHttpEndpoint(env: "PORT")
    .WithExternalHttpEndpoints();
```

Aspire assigns the listen port via `PORT` (Vite reads it) and injects the API's
address as the service-discovery variable `services__api__http__0`. A small
**Vite dev proxy** (`apps/web/vite.config.ts`) forwards `/api` — REST **and** the
`/api/collab` WebSocket (`ws: true`) — to that address, so the browser stays
**same-origin**: no CORS and no client base-URL wiring, matching the SPA's
existing relative `/api/*` calls and the collaboration socket.

Two guards keep this scoped to local development:

- **Run mode only** (`builder.ExecutionContext.IsRunMode`) — the published
  manifest (`azd` / `aspire publish`) has **no `web` resource**; the SPA ships via
  its own build/Tauri packaging. `AddNpmApp` **auto-starts** (no
  `WithExplicitStart`), unlike the marketing `site/`.
- **Dependencies present** — the resource is added only when the repo-root
  `node_modules` exists (npm workspaces hoist the SPA's deps there). This makes
  `npm ci` the one-time prerequisite and keeps `web` out of the Docker-only
  backend integration harness (`Aspire.Hosting.Testing` also runs in run mode but
  never installs the web deps). When it is missing under a real run, the AppHost
  logs a one-line `npm ci` hint and simply omits the SPA.

`Aspire.Hosting.NodeJs` is pinned via CPM to the latest version the restore feed
publishes; its `AddNpmApp`/`NodeAppResource` build only on stable hosting
primitives, so it runs cleanly on the 13.4.x AppHost. The AppHost is
`RestoreLockedMode=false`, so its committed `packages.lock.json` carries the new
package (and host-RID entries) without breaking cross-OS locked restore.

### The Tauri desktop shell under `aspire run`

`aspire run` can also launch the **`apps/desktop`** Tauri shell so the native
window loads the same Aspire-managed `web` dev server — not a second Vite (effort
#93). The desktop resource is added right beside `web`, inside the same
`node_modules` gate:

```csharp
builder.AddNpmApp("desktop", "../../apps/desktop", "tauri")
    .WithReference(web).WaitFor(web)
    .WithExplicitStart()
    .WithArgs(context =>
    {
        // npm run tauri -- dev --config {json}  ->  tauri dev with
        // beforeDevCommand cleared and devUrl pointed at `web`.
        context.Args.Add("--");
        context.Args.Add("dev");
        context.Args.Add("--config");
        context.Args.Add(ReferenceExpression.Create(
            $"{{\"build\":{{\"beforeDevCommand\":\"\",\"devUrl\":\"{web.GetEndpoint("http")}\"}}}}"));
    });
```

`apps/desktop/src-tauri/tauri.conf.json` ships `beforeDevCommand: "npm run
dev:web"` + `devUrl: http://localhost:5173`, which would self-spawn a
**backend-blind** Vite (no `PORT`, no `/api` proxy, no service discovery) that can
also collide with `web`'s dynamic port. The `--config` override clears
`beforeDevCommand` and repoints `devUrl` at `web.GetEndpoint("http")`, so Tauri
loads the exact same origin that already proxies `/api` and the `/api/collab`
WebSocket. `WithReference(web).WaitFor(web)` orders startup after the SPA is up.

Three guards keep the desktop shell scoped and non-disruptive:

- **Explicit start** (`WithExplicitStart`) — unlike `web`, the resource is
  **not** auto-started. Tauri opens a native window and needs a display plus the
  Rust toolchain, so it stays *Not started* in the dashboard until a developer
  clicks **Start**. This also keeps it inert in the Docker-only integration
  harness, which boots the AppHost in run mode but has no display.
- **Run mode only** — like `web`/`docs-site`, it is added only under
  `IsRunMode`, so the published `azd`/`aspire publish` manifest has **no
  `desktop` resource** (the desktop app ships via its own `tauri build`).
- **Rust toolchain present** — the resource is wired only when `cargo`
  (rustup) is resolvable on `PATH` or under `~/.cargo/bin`; otherwise the
  AppHost logs a one-line `https://rustup.rs` install hint and omits it, mirroring
  the `web` `node_modules` gate.

To smoke it locally: `npm ci` at the repo root, install the Rust toolchain via
[`rustup`](https://rustup.rs), then `aspire run` → open the dashboard → **Start**
the `desktop` resource. The Tauri window opens on the Aspire-served SPA.

## Collaboration document persistence (effort #91)

The live-collaboration relay (effort #9) was a pure in-memory broadcaster: it
forwarded Yjs updates between peers and dropped a room when the last peer left, so
the only durable copy of collaborative content was each client's browser autosave.
Effort #91 gives the server its **own** durable copy so a room survives all peers
disconnecting — the prerequisite for any future safe autosave suppression.

Rather than re-implement Yjs on the server, the relay persists a
**content-agnostic, append-only log of raw Yjs update payloads**. `CollabHub` loads
the log on first-peer-join and saves it on last-peer-leave; a new
`ICollabDocumentStore` / `EfCollabDocumentStore` seam writes it (framed by
`CollabDocumentCodec`) into a `CollaborationDocuments` table keyed by
`(OwnerId, ProjectId)` with a cascade FK to the owning project. Rehydration is
reactive — the server answers a reconnecting client's Yjs **SyncStep1** from the
stored log (`CollaborationEndpoints.SendSnapshotAsync`), or replies with the
empty-document update for a fresh project. Persistence sits behind the unchanged,
fail-closed viewer-write gate, so viewers still cannot persist edits. Because Yjs
updates are commutative and idempotent, replaying the log reconstructs the document
without de-duplication; log compaction is a tracked follow-up. See
[`collaboration.md`](collaboration.md).
