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
| `src/*.ServiceDefaults` | Shared telemetry/resilience/health |
| `src/*.Api` | REST + OpenAPI, Identity, entitlements |
| `src/*.Data` | EF Core model, `CadenceDbContext`, migrations, entitlement seam |
| `src/*.AiService` | Premium symbolic AI (Python/ONNX) |
| `src/*.Separation` | Demucs/ONNX stem-separation worker |
| `tests/*` | unit / integration / e2e / a11y / security |
| `infra` | `azd` + IaC |

## Cross-cutting
Test-first (TDD) everywhere · OpenTelemetry via Aspire · OAuth + secret hygiene ·
GitHub Actions CI with SHA-pinned actions (see `versioning-policy.md`).

## Identity & persistence

Accounts use ASP.NET Core Identity (local password, passwordless magic link, and
GitHub/Google/Microsoft OAuth) backed by Postgres via EF Core (`src/*.Data`).
Sessions ride a hardened `HttpOnly` cookie; the API replies with status codes so
the SPA can react. Each user has a profile and a subscription **tier** claim
(default `Free`) exposed through a minimal entitlement seam that effort #8 will
build on — no billing or feature-gating yet. Projects are **owner-scoped**: the
`/api/projects` CRUD API filters by the caller's id (non-owner access → `404`).
The web composer keeps its existing persistence seam: signed out it uses the
versioned `localStorage` store (offline-first); on sign-in it syncs local-only
projects up and switches to the remote store. See
[`auth-setup.md`](auth-setup.md).
