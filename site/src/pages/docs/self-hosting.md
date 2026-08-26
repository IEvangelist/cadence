---
layout: ../../layouts/DocsLayout.astro
title: Self-hosting & deploy
description: Deploy the Cadence Aspire backend to Azure Container Apps with azd, and enable the gated GitHub Actions deploy workflow.
---

# Self-hosting & deploy

## Public web composer versus self-hosting

The public app at
[ievangelist.github.io/cadence/app/](https://ievangelist.github.io/cadence/app/)
is a static, installable web composer. Anonymous projects, local import and
export, on-device AI, and offline use work entirely in the browser. GitHub Pages
does **not** deploy an API, collaboration relay, database, billing service, or
stem-separation worker. Features that need those services keep their existing
unavailable and sign-in states.

Self-hosting is a separate choice: it runs the repository's existing Aspire
service graph and can pair a web build with that backend. Publishing the static
app neither provisions Azure nor changes the API topology described below.

The web build makes that distinction explicit with `VITE_BACKEND_MODE`:

- `disabled` is used for the public Pages artifact. It performs no API startup
  requests and does not render account, sync, billing, collaboration, or stem
  controls.
- `same-origin` uses the existing `/api` topology, including the Aspire/Vite
  development proxy.
- `remote` requires `VITE_API_BASE_URL` to name the backend origin. If it is
  missing, the app fails closed in local-only mode instead of submitting
  credentials to the static host.

Cadence's backend deploys to **Azure Container Apps** using
[`azd`](https://learn.microsoft.com/azure/developer/azure-developer-cli/) and the
**Aspire azd integration**. There is no hand-authored Bicep to drift from the
app — azd generates the infrastructure from the Aspire AppHost model. The
authoritative service graph is
[`src/Cadence.AppHost/AppHost.cs`](https://github.com/IEvangelist/cadence/blob/main/src/Cadence.AppHost/AppHost.cs);
[`infra/README.md`](https://github.com/IEvangelist/cadence/blob/main/infra/README.md)
carries the full go-live runbook.

## Run the backend locally

You do **not** need any Azure resources to run Cadence locally. From the repo
root:

```bash
aspire run
```

The AppHost brings up the full local stack — Postgres, Redis, the Azurite blob
emulator, the API, and the stem-separation worker — and, when their prerequisites
are present, also serves the `apps/web` SPA (and can start the `apps/desktop`
Tauri shell). This works because the AppHost declares its cloud resources with
local fallbacks: `.RunAsContainer()` on Postgres/Redis and `.RunAsEmulator()` on
storage apply to **run mode only**. See
[Getting started](../getting-started/) for prerequisites (the .NET SDK, Node,
Docker, and the optional Rust toolchain).

## How it works

The project manifest [`azure.yaml`](https://github.com/IEvangelist/cadence/blob/main/azure.yaml)
points azd at the Aspire AppHost:

```yaml
services:
  app:
    language: dotnet
    project: ./src/Cadence.AppHost/Cadence.AppHost.csproj
    host: containerapp
```

When azd sees an Aspire AppHost it generates a Container Apps environment plus a
container app per project, and provisions the backing resources exactly as the
AppHost declares them:

| Resource | AppHost declaration | Provisioned on publish |
|---|---|---|
| PostgreSQL | `AddAzurePostgresFlexibleServer("postgres").RunAsContainer()` | Azure Database for PostgreSQL flexible server (managed, durable) |
| Redis | `AddAzureRedis("redis").RunAsContainer()` | Azure Cache for Redis (managed) |
| Blob storage | `AddAzureStorage("storage").RunAsEmulator().AddBlobs("blobs")` | Azure Storage account + Blob service |
| API | `AddProject<Cadence_Api>("api").WithExternalHttpEndpoints()` | Container app with **external** (internet-facing) ingress |
| Separation worker | `AddProject<Cadence_SeparationWorker>("separation")` | Container app (no inbound ingress) |

The `.RunAsContainer()` / `.RunAsEmulator()` calls keep local `aspire run` on
containers and the Azurite emulator; on **publish** azd emits the managed Azure
services above, so production data is durable across revision restarts. The API's
`WithExternalHttpEndpoints()` gives it public ingress so a separately configured
web SPA, including a GitHub Pages build, can reach it; cross-origin browser access is then gated by the
`Cors:AllowedOrigins` policy (see [Required configuration](#required-configuration)).
The AppHost is the single source of truth: change a resource there and azd picks
it up on the next `azd provision`.

## Required configuration

The API binds a handful of configuration sections. Everything ships with safe,
non-secret defaults for local development (see
[`appsettings.json`](https://github.com/IEvangelist/cadence/blob/main/src/Cadence.Api/appsettings.json));
you supply the rest per environment. **Never commit real secrets** — provide them
through environment variables, .NET user-secrets (local), or Key Vault
(deployed). Use `Section__Key` (double underscore) for environment-variable form.

| Section / key | Default | Purpose |
|---|---|---|
| `Cors:AllowedOrigins` | `["https://ievangelist.github.io"]` | Browser origins allowed to call the API with credentials. Add custom domains / preview origins here. |
| `Authentication:Web:BaseUrl` | `https://localhost:5173` | The SPA origin the API redirects back to after an OAuth sign-in. |
| `Authentication:GitHub:ClientId` / `ClientSecret` | empty | GitHub OAuth app credentials. The provider is enabled only when **both** are set. |
| `Authentication:Google:ClientId` / `ClientSecret` | empty | Google OAuth credentials (same opt-in rule). |
| `Authentication:Microsoft:ClientId` / `ClientSecret` | empty | Microsoft account OAuth credentials (same opt-in rule). |
| `Billing:Stripe:SecretKey` / `PublishableKey` / `WebhookSecret` / `PriceId` | empty | Stripe API keys, the webhook signing secret, and the price id for the paid (Pro) plan. |
| `Billing:SuccessUrl` / `CancelUrl` / `PortalReturnUrl` | empty | Post-checkout and billing-portal return URLs. |
| `ApiDocs:Enabled` | `true` | Serve `/openapi/v1.json` and `/scalar`. Set to `false` to hide the API reference on a hardened deployment. |
| `Stems:ModelUri` / `Stems:ModelSha256` | unset | Optional pinned Demucs ONNX model URI and its 64-digit hexadecimal SHA-256. A remote Production model requires both values and HTTPS; unset uses the deterministic band-split fallback. |
| `Stems:MaxUploadBytes` / `MaxDurationSeconds` | `52428800` / `600` | Positive upload-byte and WAV-duration limits. |
| `Stems:ProcessingLeaseSeconds` / `MaxAttempts` | `300` / `3` | Positive worker lease/reaper bounds. |

Connection strings for Postgres, Redis, and Blob storage are injected by the
Aspire AppHost (locally and on publish), so you do not set them by hand. Stripe
settings are forwarded from the AppHost's configuration to the API only when
present, so a local run needs none of them.

The API and separation worker eagerly validate `Stems` at startup
(`ValidateOnStart`) and exit before serving or claiming jobs when these bounds are
zero/negative or the model settings are incoherent. For a remote production
model, configure both processes with:

```bash
Stems__ModelUri=https://models.example.com/htdemucs.onnx
Stems__ModelSha256=<64-hex-digit-sha256>
```

`file://` URIs and local paths remain supported for operator-managed model files.
The worker verifies a cached/downloaded model before use; a poisoned cache entry
is purged and re-downloaded. Plain HTTP and unsupported remote URI schemes are
rejected. The checksum accepts hexadecimal case differences and an optional
`sha256:` prefix.

## Deploy from your machine

```bash
# Prerequisites: the azd CLI, the .NET 10 SDK, and Docker running.

# One-time per environment
azd auth login
azd env new cadence-prod --location eastus2 --subscription <sub-id>

# Provision Azure resources + build and deploy the app
azd up
```

`azd up` = `azd provision` (infra) + `azd deploy` (app). Tear everything down with
`azd down --purge`.

To review the generated infrastructure, materialize it to disk with
`azd infra gen` — it writes the Bicep under `./infra`. Treat it as a reviewable
snapshot; the live source of truth remains the AppHost, so regenerate rather than
hand-edit.

## Deploy from GitHub Actions (gated)

[`.github/workflows/deploy.yml`](https://github.com/IEvangelist/cadence/blob/main/.github/workflows/deploy.yml)
deploys via azd and is deliberately **isolated from the CI matrix** so it can
never fail a pull request or run without cloud credentials:

- **`workflow_dispatch` only** — triggered manually, never by push or PR.
- **Protected `production` environment** — it waits for a required reviewer before
  it can read the Azure credentials. That approval is the deploy gate.
- **OIDC federated login** — no client secret is stored; azd signs in with a
  short-lived GitHub OIDC token (`id-token: write`).

### Required configuration

In **Settings → Environments**, create a `production` environment, add a required
reviewer, then set these **secrets**:

| Secret | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | App registration (service principal) client id |
| `AZURE_TENANT_ID` | Entra tenant id |
| `AZURE_SUBSCRIPTION_ID` | Target subscription id |

The environment name and Azure region are dispatch **inputs** (`cadence-prod` /
`eastus2` by default).

### One-time Azure setup (federated identity)

```bash
# Creates the app registration, a federated credential for this
# repo/environment (so no secret is needed), and assigns roles.
azd pipeline config --provider github
```

Alternatively, create the app registration manually and add a federated
credential whose subject matches
`repo:IEvangelist/cadence:environment:production`.

> **No secrets are committed.** Credentials live only in the protected
> environment. `appsettings.json` ships empty auth placeholders — supply real
> provider secrets through the environment or Key Vault. See
> [Authentication](../auth/).

## Version pinning

Per [Versioning policy](../versioning/): every GitHub Action in the deploy workflow
is pinned to a full commit SHA with a version comment, and azd pins the Aspire /
azd toolchain. Base images resolved by azd inherit the AppHost's pinned package
versions.
