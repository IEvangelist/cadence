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
GitHub Actions CI with SHA-pinned actions (see `versioning-policy.md`). The web
composer is extensible through a typed, in-process **Plugin SDK** — instruments,
effects, formats, AI providers, commands, and panels all register through one host
(see [`plugins.md`](plugins.md)).

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
