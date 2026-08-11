---
layout: ../../layouts/DocsLayout.astro
title: Architecture
description: How Cadence fits together — the Tauri desktop shell, the TypeScript SPA, and the Aspire service graph.
---

# Architecture

Cadence is a desktop-first client over a single .NET Aspire backend. The service
graph is defined in
[`src/Cadence.AppHost/AppHost.cs`](https://github.com/IEvangelist/cadence/blob/main/src/Cadence.AppHost/AppHost.cs),
which is the source of truth; the repository's
[`docs/architecture.md`](https://github.com/IEvangelist/cadence/blob/main/docs/architecture.md)
carries the longer-form roadmap.

## The big picture

```
+------------------- Tauri Desktop Shell (Rust) -------------------+
|  TypeScript SPA (React 19 + Vite)                                |
|   - Composer canvas: piano roll, transport, mixer               |
|   - Audio engine: Tone.js / Web Audio; Web MIDI (webmidi.js)    |
|   - Notation: OpenSheetMusicDisplay (MusicXML) + VexFlow        |
|   - Multitrack mixer + isolated stem tracks                     |
|   - On-device AI: Magenta.js + TensorFlow.js (in the browser)   |
|   - Plugin SDK: instruments/effects/formats/AI/commands/panels  |
|   - Collab client: Yjs (CRDT) + awareness/presence             |
+------------------------------ HTTPS / WSS ----------------------+
                              |
     +------------------------v----------- Aspire AppHost --------+
     |  Cadence.Api (ASP.NET Core minimal API)                    |
     |    - REST + OpenAPI / Scalar reference UI                  |
     |    - Identity + GitHub / Google / Microsoft OAuth          |
     |    - Entitlements + Stripe billing & webhooks              |
     |    - In-process collaboration relay: /api/collab/{id}      |
     |    - External ingress + config-driven CORS                 |
     |                                                            |
     |  Cadence.SeparationWorker (BackgroundService)              |
     |    - Demucs/ONNX with a deterministic band-split fallback  |
     |                                                            |
     |  Postgres (Flexible Server) · Redis (Azure Cache)          |
     |  Blob storage (Azurite emulator in dev)                    |
     +------------------------------------------------------------+
```

There is **no separate collaboration server and no server-side AI service**: the
real-time relay is an endpoint inside `Cadence.Api`, and the shipped AI assistant
runs entirely **on-device** in the browser. Both are common points of confusion,
so they are called out explicitly below.

## Projects

| Path | Role |
|---|---|
| `apps/web` | React 19 + Vite SPA — the whole UI, including the Plugin SDK |
| `apps/desktop` | Tauri shell (Rust) wrapping the SPA |
| `src/Cadence.AppHost` | Aspire orchestration — the service graph |
| `src/Cadence.ServiceDefaults` | Shared OpenTelemetry / resilience / health |
| `src/Cadence.Api` | Minimal API: REST + OpenAPI, Identity/OAuth, entitlements, Stripe billing, and the in-process collaboration relay |
| `src/Cadence.Data` | EF Core model, `CadenceDbContext`, migrations, entitlement seam |
| `src/Cadence.SeparationWorker` | Background stem-separation worker (Demucs/ONNX + band-split fallback) |
| `tests/*` | unit / integration / e2e / a11y / security |
| `infra` | `azd` deployment (`azure.yaml` → Aspire azd integration) |

There is no `Cadence.AiService` project: AI generation is on-device only (see
[Cross-cutting concerns](#cross-cutting-concerns) and [Features](../features/)).

## The service graph

The Aspire AppHost (`src/Cadence.AppHost/AppHost.cs`) models the backend as a
graph of resources the API depends on:

- **Postgres** (`postgres`) with a `cadencedb` database — projects, users,
  separation jobs, and metadata via EF Core. Declared with
  `AddAzurePostgresFlexibleServer("postgres").RunAsContainer()`: a local Postgres
  container under `aspire run`, a managed **Azure Database for PostgreSQL
  flexible server** on publish (so production data survives revision restarts).
- **Redis** (`redis`) — presence and caching, plus Redis-backed auth rate
  limiting when the connection string is present. Declared with
  `AddAzureRedis("redis").RunAsContainer()`: a local Redis container in dev, a
  managed **Azure Cache for Redis** on publish.
- **Blob storage** (`blobs`) — audio and asset storage, backed by the **Azurite**
  emulator in development and a real Azure Storage account on publish.
- **API** (`api`) — the ASP.NET Core service, wired to all three with
  health-gated startup (`WaitFor`). It publishes an **external HTTP ingress**
  (`WithExternalHttpEndpoints()`) so the GitHub Pages SPA — a different origin —
  can reach it; cross-origin browser access is then gated by the server-side CORS
  policy (`Cors:AllowedOrigins`). Stripe settings are forwarded from configuration
  only when present (`WithBillingConfiguration`).
- **Separation worker** (`separation`) — a background .NET worker that shares the
  Postgres and Blob resources and needs no inbound traffic of its own.

Because the topology lives in the AppHost, the same model drives both local
development and cloud deployment — see [Self-hosting & deploy](../self-hosting/).
Under `aspire run` the AppHost also serves the `apps/web` SPA and can start the
`apps/desktop` Tauri shell and this docs site when their prerequisites are
present.

## Live collaboration

Opt-in real-time co-editing binds the composer project to a **Yjs (CRDT)**
document so concurrent edits merge deterministically; presence (live
cursors/selections + roster) rides the Yjs awareness protocol. The relay is a
**first-party ASP.NET Core WebSocket endpoint inside `Cadence.Api`**
(`/api/collab/{projectId}`) — **not** a separate `y-websocket` container — so each
connection *and each message* is authorized server-side against the identity
cookie and the projects/share-link tables. Share links carry a server-persisted
role (owner / editor / viewer); **viewer document-writes are dropped at the
message boundary** before fan-out, so read-only access is enforced
server-authoritatively (fail closed). Rooms have a durable, append-only log of Yjs
update payloads so a room survives all peers disconnecting. Collaboration is inert
until a session is explicitly activated, so single-user behavior is unchanged.

## Stem separation

Cadence splits an uploaded mix into isolated **stems** (bass, drums, vocals,
guitar, keys, synth, other) through an authenticated, owner-scoped **asynchronous
job pipeline**. `Cadence.Api` (`/api/stems`) gates creation on the Pro
`StemSeparation` entitlement (free → `402`), validates content-type/size/duration,
persists an owner-scoped `SeparationJob`, and stores the mix in Blob. The
`Cadence.SeparationWorker` claims queued jobs, separates them, and writes labeled
stems back to Blob for owner-scoped download. The separation model is **Demucs v4
(`htdemucs`)** via ONNX Runtime, fetched-and-cached at runtime; when no model is
pinned (the CI/dev default) a deterministic band-split engine drives the same
`IStemSeparator` seam, keeping tests hermetic.

## Plugin SDK

The web composer is extensible through a typed, in-process **Plugin SDK**
(`apps/web/src/composer/plugins/`). Instruments, effects, import/export formats,
AI providers, commands, and panels all register through one host — and the app's
own built-ins (its 64 instruments, its MusicXML/portable-project codecs, its
on-device AI provider) are registered through that same seam. See the
[Plugin SDK](../plugin-sdk/) guide.

## API reference (OpenAPI + Scalar)

The API publishes its REST surface as an OpenAPI document at `/openapi/v1.json`
and ships an interactive [**Scalar**](https://scalar.com/) reference UI at
`/scalar`, both gated by a single flag, **`ApiDocs:Enabled`** (default `true`).
Operators turn the reference off (for example on a hardened public deployment) by
setting `ApiDocs__Enabled=false`. The [API reference](../api-reference/) page
covers how to reach it and summarizes each endpoint group.

## Cross-cutting concerns

Test-first (TDD) throughout · OpenTelemetry via Aspire ServiceDefaults · OAuth
with strict secret hygiene · GitHub Actions CI with **SHA-pinned** actions (see
[Versioning policy](../versioning/)).

**On-device AI.** The shipped composition assistant runs **in the browser**
(Magenta.js on TensorFlow.js) — there is no server-side AI generation service.
Suggestions are computed on the user's machine and never leave it, which is why
the free tier's generation cap is a client-side budget rather than a metered API.

## Identity & persistence

Accounts use ASP.NET Core Identity (local password, passwordless magic link, and
GitHub/Google/Microsoft OAuth) backed by Postgres via EF Core. Sessions ride a
hardened `HttpOnly` cookie, and the API replies with status codes so the SPA can
react. Every user carries a subscription **tier** claim (default `Free`) exposed
through a minimal entitlement seam; server-enforced limits (project caps,
stem-separation access) reject over-limit or paid-only requests with `402`.
Projects are **owner-scoped**: the `/api/projects` CRUD API filters by the
caller's id, and non-owner access returns `404`. Full detail lives in
[Authentication](../auth/).
