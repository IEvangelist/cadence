# src

The .NET back end for Cadence, orchestrated by
[Aspire](https://aspire.dev). Every project targets
**.NET 10** (pinned via the root [`global.json`](../global.json)) and uses Central
Package Management ([`Directory.Packages.props`](../Directory.Packages.props)) with
exact, pinned versions and lockfile-backed restore. The solution is
[`Cadence.slnx`](../Cadence.slnx).

## Projects

| Project | Role |
| --- | --- |
| **`Cadence.AppHost`** | The Aspire orchestrator. Wires PostgreSQL, Redis, and Blob storage (the Azurite emulator in development), then launches the `api` and `separation` services plus the Aspire dashboard. **Start here** to run everything locally. |
| **`Cadence.Api`** | The ASP.NET Core web API: identity with passwordless magic-link sign-in, user profiles, projects, freemium billing/entitlements and Stripe webhooks, stem-separation endpoints, and an OpenAPI + [Scalar](https://scalar.com) API reference. |
| **`Cadence.Data`** | Shared EF Core data model and domain logic over PostgreSQL + Blob storage — ASP.NET Core Identity, projects, billing/entitlements, and stem-separation persistence, including the EF Core migrations. |
| **`Cadence.SeparationWorker`** | Background worker that drains queued stem-separation jobs, runs the separation engine, and writes labeled stems back to Blob storage (part of #10). It takes no inbound traffic. |
| **`Cadence.ServiceDefaults`** | Shared Aspire service defaults: OpenTelemetry, health checks, resilience, and service discovery. |

Tests live under [`../tests`](../tests):

- **`Cadence.Api.Tests`** — unit tests.
- **`Cadence.Api.IntegrationTests`** — end-to-end API + database integration tests.

See [`../docs/testing.md`](../docs/testing.md) for how to run every suite and the CI gates.

## Run locally

**Prerequisites**

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — Aspire starts the
  PostgreSQL, Redis, and Azurite (Blob) containers for you.

From the repository root:

```bash
aspire run
```

Aspire boots the containers and services, then opens the **Aspire dashboard**. The
dashboard (and every endpoint) binds to a dynamic, OS-assigned port that is printed in
the console, so several contributors — or several branches — can run the stack at once
without colliding (#58). Use the dashboard to inspect resources, logs, traces, and the
live API endpoints.

> The web UI (`apps/web`) runs separately — the AppHost orchestrates the back end only.
> See [`../apps/web/README.md`](../apps/web/README.md) to start the SPA and
> [`../README.md`](../README.md) for the full-stack quick start.

## Determinism

- **Central Package Management** — every package version is pinned in
  `Directory.Packages.props`.
- **Lockfile-backed restore** — each project commits a `packages.lock.json`.
- **SDK pinned** — the .NET SDK version is fixed in `global.json`.

## More

- [`../docs/README.md`](../docs/README.md) — the documentation index.
- [`../docs/architecture.md`](../docs/architecture.md) — the service graph and how the
  pieces fit together.
