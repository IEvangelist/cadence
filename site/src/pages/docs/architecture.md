---
layout: ../../layouts/DocsLayout.astro
title: Architecture
description: How Cadence fits together — the Tauri desktop shell, the TypeScript SPA, and the .NET Aspire service graph.
---

# Architecture

Cadence is a desktop-first client over a .NET Aspire backend. This page mirrors
[`docs/architecture.md`](https://github.com/IEvangelist/cadence/blob/main/docs/architecture.md);
the repository is the source of truth.

## The big picture

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
      |  .NET Aspire AppHost    |   | Yjs collab relay    |
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

## Projects

| Path | Role |
|---|---|
| `apps/web` | TypeScript SPA (Vite + React) — the whole UI |
| `apps/desktop` | Tauri shell (Rust) wrapping the SPA |
| `src/*.AppHost` | Aspire orchestration |
| `src/*.ServiceDefaults` | Shared telemetry / resilience / health |
| `src/*.Api` | REST + OpenAPI, Identity, entitlements |
| `src/*.Data` | EF Core model, `CadenceDbContext`, migrations, entitlement seam |
| `src/*.AiService` | Premium symbolic AI (Python/ONNX) |
| `src/*.Separation` | Demucs/ONNX stem-separation worker |
| `tests/*` | unit / integration / e2e / a11y / security |
| `infra` | `azd` + IaC |

## The service graph

The Aspire AppHost (`src/Cadence.AppHost/AppHost.cs`) models the backend as a
graph of resources the API depends on:

- **Postgres** (`postgres`) with a `cadencedb` database — projects, users, and
  metadata via EF Core.
- **Redis** (`redis`) — presence, caching, and rate-limiting.
- **Blob storage** (`blobs`) — audio and asset storage, backed by the **Azurite**
  emulator in development.
- **API** (`api`) — the ASP.NET Core service, wired to all three with health-gated
  startup (`WaitFor`).

Because the topology lives in the AppHost, the same model drives both local
development and cloud deployment — see [Self-hosting & deploy](../self-hosting/).

## API reference (OpenAPI + Scalar)

The API (`src/Cadence.Api`) publishes its REST surface as an OpenAPI document and
ships with an interactive [**Scalar**](https://scalar.com/) reference UI rendered
over it — the standard for Cadence APIs.

| Route | Serves |
|---|---|
| `/openapi/v1.json` | The generated OpenAPI document |
| `/scalar` | The Scalar interactive API reference UI |

Both are enabled in **all environments by default** and gated by a single flag,
**`ApiDocs:Enabled`** (bound from configuration, default `true`). Operators set
`ApiDocs__Enabled=false` (env var) or `"ApiDocs": { "Enabled": false }` (config) to
turn the docs off — for example in production. Development works out of the box.

Because the reference ships enabled everywhere, a public deployment exposes the
full API surface at `/scalar` and `/openapi/v1.json` unless `ApiDocs:Enabled` is
set to `false` — a deliberate discoverability-vs-exposure tradeoff operators own.

## Cross-cutting concerns

Test-first (TDD) throughout · OpenTelemetry via Aspire ServiceDefaults · OAuth
with strict secret hygiene · GitHub Actions CI with **SHA-pinned** actions (see
[Versioning policy](../versioning/)).

## Identity & persistence

Accounts use ASP.NET Core Identity (local password, passwordless magic link, and
GitHub/Google/Microsoft OAuth) backed by Postgres via EF Core. Sessions ride a
hardened `HttpOnly` cookie, and the API replies with status codes so the SPA can
react. Every user carries a subscription **tier** claim (default `Free`) exposed
through a minimal entitlement seam. Projects are **owner-scoped**: the
`/api/projects` CRUD API filters by the caller's id, and non-owner access returns
`404`. Full detail lives in [Authentication](../auth/).
