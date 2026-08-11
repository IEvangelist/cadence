---
layout: ../../layouts/DocsLayout.astro
title: API reference
description: Reach Cadence's OpenAPI document and Scalar reference UI, and browse the REST endpoint groups — auth, profile, projects, collaboration, stems, and billing.
---

# API reference

The Cadence backend is an **ASP.NET Core minimal API** (`src/Cadence.Api`). It
publishes a generated **OpenAPI** document and ships an interactive
[**Scalar**](https://scalar.com/) reference UI rendered over it, so the API always
travels with its own reference.

## Reaching the reference

| Route | Serves |
|---|---|
| `/openapi/v1.json` | The generated OpenAPI document |
| `/scalar` | The Scalar interactive API reference UI |

Both are gated by a single configuration flag, **`ApiDocs:Enabled`** (default
`true`), so they are available in every environment out of the box. To hide the
reference — for example on a hardened public deployment — set
`ApiDocs__Enabled=false` (environment variable) or `"ApiDocs": { "Enabled": false }`
(configuration). Because the spec is generated from the endpoints, it never drifts
from the running API; a hand-maintained spec is therefore **not** a future
enhancement here.

## Base URL and conventions

- **Base path:** every route is under `/api`. In local development the SPA reaches
  it same-origin through the Vite dev proxy; in production the API runs as an Azure
  Container App with external ingress, and browser origins are gated by CORS
  (`Cors:AllowedOrigins`). See [Self-hosting & deploy](../self-hosting/).
- **Auth:** session-cookie based (`cadence.auth`, `HttpOnly`). Endpoints marked
  **Auth** below require a signed-in session; unauthenticated calls get `401`. See
  [Authentication](../auth/) for the full sign-in flow.
- **Ownership:** projects, stem jobs, and share links are **owner-scoped**.
  Accessing another user's resource returns `404` (not `403`), so the API never
  reveals that an id exists.
- **Errors:** failures use RFC 9457 `application/problem+json`. A paid-only action
  on the free tier returns **`402 Payment Required`** with the problem type
  `https://cadence.app/problems/upgrade-required`.

## Endpoint groups

### Auth — `/api/auth`

Local password, passwordless magic link, and GitHub/Google/Microsoft OAuth. The
login and magic-link routes are rate-limited.

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `POST` | `/api/auth/register` | — | Create an account (sends a verification email) |
| `GET` | `/api/auth/register/verify` | — | Confirm a registration from the emailed link |
| `POST` | `/api/auth/login` | — | Sign in with email + password (rate-limited) |
| `POST` | `/api/auth/logout` | Auth | Sign out and clear the session cookie |
| `GET` | `/api/auth/me` | Auth | The current user and subscription tier |
| `POST` | `/api/auth/magic-link` | — | Request a passwordless sign-in link (rate-limited) |
| `GET` | `/api/auth/magic-link/verify` | — | Complete a magic-link sign-in (rate-limited) |
| `GET` | `/api/auth/external/{provider}` | — | Begin an OAuth challenge for a provider |
| `GET` | `/api/auth/external/callback` | — | OAuth return endpoint |
| `GET` | `/api/auth/providers` | — | List the OAuth providers that are configured |

### Profile — `/api/profile`

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `GET` | `/api/profile` | Auth | Read the current user's profile |
| `PUT` | `/api/profile` | Auth | Update the current user's profile |

### Projects — `/api/projects`

Owner-scoped CRUD. Creating past the tier's project cap (free = 10) returns `402`.

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `GET` | `/api/projects` | Auth | List the caller's projects |
| `POST` | `/api/projects` | Auth | Create a project (cap-gated → `402`) |
| `GET` | `/api/projects/{id}` | Auth | Fetch one project (non-owner → `404`) |
| `PUT` | `/api/projects/{id}` | Auth | Update a project |
| `DELETE` | `/api/projects/{id}` | Auth | Delete a project |

### Collaboration — `/api/projects/{projectId}/shares` and `/api/collab`

Owner-only share-link management plus the real-time relay. The relay is an
in-process WebSocket endpoint that fans out Yjs updates; the connection is
authorized against the session cookie and the share-link role, and **viewer
writes are dropped server-side**.

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `GET` | `/api/projects/{projectId}/shares` | Auth (owner) | List a project's share links |
| `POST` | `/api/projects/{projectId}/shares` | Auth (owner) | Create a share link with an owner/editor/viewer role |
| `DELETE` | `/api/projects/{projectId}/shares/{token}` | Auth (owner) | Revoke a share link |
| `GET` (WebSocket) | `/api/collab/{projectId}` | Auth | Join the project's real-time collaboration room |

### Stems — `/api/stems`

An authenticated, owner-scoped async job pipeline. Creating a job requires the
paid **stem-separation** entitlement (free → `402`).

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `POST` | `/api/stems/jobs` | Auth | Upload a mix and queue a separation job (entitlement-gated → `402`) |
| `GET` | `/api/stems/jobs` | Auth | List the caller's separation jobs |
| `GET` | `/api/stems/jobs/{id}` | Auth | Poll a job's status |
| `GET` | `/api/stems/jobs/{id}/stems/{label}` | Auth | Download a finished stem (`bass`, `drums`, `vocals`, `guitar`, `keys`, `synth`, `other`) |

### Billing & entitlements

Stripe-backed checkout and billing portal, plus the entitlement view the SPA reads
to gate features. The webhook is anonymous but verified against the Stripe
signature.

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `GET` | `/api/entitlements` | Auth | The caller's resolved entitlement set (tier, caps, flags) |
| `POST` | `/api/billing/checkout` | Auth | Start a Stripe Checkout session for the paid plan |
| `POST` | `/api/billing/portal` | Auth | Open the Stripe billing portal (`402` if never subscribed) |
| `POST` | `/api/billing/webhook` | — | Stripe webhook (signature-verified, not cookie-authed) |

### Meta

| Method | Route | Auth | Purpose |
|---|---|:--:|---|
| `GET` | `/api/info` | — | Service name and version (liveness/build check) |

For request and response shapes, browse the live **Scalar** UI at `/scalar` or the
raw document at `/openapi/v1.json`.
