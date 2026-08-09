# infra

Deployment and infrastructure-as-code for the Cadence backend. Target:
**Azure Container Apps** via [`azd`](https://learn.microsoft.com/azure/developer/azure-developer-cli/)
using the **.NET Aspire azd integration**, owned by the **DevOps/Release** squad.

## How it works

There is no hand-authored Bicep to drift from the app. The project manifest
[`azure.yaml`](../azure.yaml) (repo root) points azd at the Aspire AppHost:

```yaml
services:
  app:
    language: dotnet
    project: ./src/Cadence.AppHost/Cadence.AppHost.csproj
    host: containerapp
```

When azd sees an Aspire AppHost it generates the infrastructure **from the
AppHost model** at provision time — a Container Apps environment plus a container
app per project — and provisions the backing resources exactly as
[`src/Cadence.AppHost/AppHost.cs`](../src/Cadence.AppHost/AppHost.cs) declares
them:

| Resource | AppHost declaration | Provisioned as |
|---|---|---|
| PostgreSQL | `AddPostgres("postgres").AddDatabase("cadencedb")` | Postgres container in the Container Apps environment |
| Redis | `AddRedis("redis")` | Redis container in the Container Apps environment |
| Blob storage | `AddAzureStorage("storage").AddBlobs("blobs")` | Azure Storage account + Blob service |
| API | `AddProject<Cadence_Api>("api")` | Container app (image built by azd) |

> The AppHost is the single source of truth. To move Postgres/Redis to managed
> Azure services later (`AddAzurePostgresFlexibleServer` / `AddAzureRedis`), edit
> the AppHost — azd picks the change up on the next `azd provision`. This infra
> surface deliberately does **not** modify the AppHost.

## Deploy from your machine

```bash
# One-time per environment
azd auth login
azd env new cadence-prod --location eastus2 --subscription <sub-id>

# Provision Azure resources + build and deploy the app
azd up
```

`azd up` = `azd provision` (infra) + `azd deploy` (app). Tear everything down with
`azd down --purge`.

### Materialize the generated Bicep (optional, for review)

The IaC is generated on demand, but you can write it to disk to review or pin it:

```bash
azd infra gen        # writes the generated Bicep under ./infra
```

Anything generated here is a reviewable snapshot; the live source of truth remains
the AppHost. Do not hand-edit generated files — regenerate instead.

## CI deploy workflow — gated, never runs on PRs

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) deploys via azd
and is **isolated from the CI matrix** so it can never fail a pull request or run
without cloud credentials:

- **`workflow_dispatch` only** — it is triggered manually, never by push/PR.
- **Protected `production` environment** — it waits for a required reviewer, and
  only then can it read the Azure secrets/vars, which is the human deploy gate.
- **OIDC federated login** — no client secret is stored; azd logs in with a
  short-lived GitHub OIDC token (`id-token: write`).

### Required configuration (Settings → Environments → `production`)

Create the `production` environment, add a required reviewer, then set:

| Kind | Name | Purpose |
|---|---|---|
| Secret | `AZURE_CLIENT_ID` | App registration (service principal) client id |
| Secret | `AZURE_TENANT_ID` | Entra tenant id |
| Secret | `AZURE_SUBSCRIPTION_ID` | Target subscription id |

The environment name and Azure region are `workflow_dispatch` **inputs**
(`cadence-prod` / `eastus2` by default) — change them at dispatch time.

### One-time Azure setup (federated identity)

```bash
# Create an app registration and grant it Contributor + RBAC on the subscription
azd pipeline config --provider github
```

`azd pipeline config` creates the app registration, the **federated credential**
for this repository/environment (so no secret is needed), and assigns the roles.
Alternatively, create the app registration manually and add a federated
credential whose subject matches
`repo:IEvangelist/cadence:environment:production`.

> **No secrets are committed.** Credentials live only in the protected
> environment. `appsettings.json` ships empty auth placeholders; supply real
> provider secrets through the environment or Key Vault (see
> [`docs/auth-setup.md`](../docs/auth-setup.md)).

## Version pinning

Per [`docs/versioning-policy.md`](../docs/versioning-policy.md): every GitHub
Action in `deploy.yml` is pinned to a full commit SHA with a version comment, and
azd pins the Aspire/azd toolchain. Base container images resolved by azd inherit
the AppHost's pinned package versions.
