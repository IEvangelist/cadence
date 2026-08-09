---
layout: ../../layouts/DocsLayout.astro
title: Self-hosting & deploy
description: Deploy the Cadence Aspire backend to Azure Container Apps with azd, and enable the gated GitHub Actions deploy workflow.
---

# Self-hosting & deploy

Cadence's backend deploys to **Azure Container Apps** using
[`azd`](https://learn.microsoft.com/azure/developer/azure-developer-cli/) and the
**.NET Aspire azd integration**. There is no hand-authored Bicep to drift from the
app — azd generates the infrastructure from the Aspire AppHost model. This page
mirrors [`infra/README.md`](https://github.com/IEvangelist/cadence/blob/main/infra/README.md).

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

| Resource | AppHost declaration | Provisioned as |
|---|---|---|
| PostgreSQL | `AddPostgres("postgres").AddDatabase("cadencedb")` | Postgres container in the Container Apps environment |
| Redis | `AddRedis("redis")` | Redis container in the Container Apps environment |
| Blob storage | `AddAzureStorage("storage").AddBlobs("blobs")` | Azure Storage account + Blob service |
| API | `AddProject<Cadence_Api>("api")` | Container app (image built by azd) |

The AppHost is the single source of truth. To move Postgres/Redis to managed Azure
services later (`AddAzurePostgresFlexibleServer` / `AddAzureRedis`), edit the
AppHost — azd picks up the change on the next `azd provision`.

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
