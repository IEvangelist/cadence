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
