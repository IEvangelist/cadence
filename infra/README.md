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
| PostgreSQL | `AddPostgres("postgres").AddDatabase("cadencedb")` | Postgres container app in the Container Apps environment |
| Redis | `AddRedis("redis")` | Redis container app in the Container Apps environment |
| Blob storage | `AddAzureStorage("storage").AddBlobs("blobs")` | Azure Storage account + Blob service (identity-only access) |
| API | `AddProject<Cadence_Api>("api")` | Container app (image built by azd, pushed to ACR) |

> The AppHost is the single source of truth. To move Postgres/Redis to managed
> Azure services later (`AddAzurePostgresFlexibleServer` / `AddAzureRedis`), edit
> the AppHost — azd picks the change up on the next `azd provision`. This infra
> surface deliberately does **not** modify the AppHost.

> **Note on the storage emulator.** The AppHost calls `.RunAsEmulator()` on
> storage, which applies to **local `run` mode only** (Azurite). In `publish`/
> deploy mode azd emits a real Azure Storage account — the emulator never leaks
> into the deployed infrastructure.

## Validation (no cloud spend)

The AppHost → Container Apps translation is validated **without provisioning,
without Docker, and without any Azure login** by generating the IaC and the
Aspire manifest locally:

```bash
# 1) Aspire deployment manifest (pure .NET SDK — no azd, no Docker, no login)
dotnet run --project ../src/Cadence.AppHost/Cadence.AppHost.csproj \
  -- --publisher manifest --output-path ./aspire-manifest.json

# 2) Full ACA Bicep from the AppHost model (azd, offline — no login/provision)
azd env new cadence-validate --location eastus2 --subscription <any-guid> --no-prompt
azd infra generate -e cadence-validate --force
```

`azd infra generate` (alias `azd infra gen`) writes reviewable IaC to `./infra`
(`main.bicep`, `resources.bicep`, `main.parameters.json`, `storage/`,
`storage-roles/`) plus per-service Container Apps templates under
`../src/Cadence.AppHost/infra/*.tmpl.yaml`. Neither the manifest nor the
generated files are committed — they are regenerated on demand, so the AppHost
stays the single source of truth. Delete them (and the local `.azure/` env
folder) after review.

A generation run against the current AppHost produces this topology, which
confirms the model yields sensible, secure ACA infrastructure:

| Generated resource | Detail |
|---|---|
| Resource group | `rg-<env-name>` (subscription-scoped deployment) |
| User-assigned managed identity | Workload identity for every container app |
| Azure Container Registry | `Basic` SKU; MI granted **AcrPull** (no admin user, no registry keys) |
| Log Analytics workspace | `PerGB2018`; wired to the environment for app logs |
| Container Apps environment | **Consumption** workload profile + built-in Aspire dashboard |
| Storage account | `StorageV2`, `Standard_GRS`, Hot; **`allowSharedKeyAccess: false`**, `minimumTlsVersion: TLS1_2` |
| Storage RBAC | MI granted Storage **Blob/Table/Queue Data Contributor** (key-less access) |
| Postgres / Redis | Container apps, **internal** ingress; passwords are azd-**generated 22-char secrets** |
| API | Container app pulling from ACR via the MI, wired to all three backing resources |

No secrets are materialized to disk: the Postgres/Redis passwords are declared as
azd `generate` parameters and created at provision time.

### Decisions to confirm before go-live

Two properties of the generated infra are **product decisions**, not infra bugs.
They are called out here so a human confirms them before the first real deploy;
fixing either means editing the AppHost, which is **out of scope** for this infra
surface (flag the owning squad):

1. **API ingress is internal-only.** The AppHost does not call
   `WithExternalHttpEndpoints()` on the `api` project, so azd generates an
   **internal** ingress — the API is reachable only inside the Container Apps
   environment, not from the public internet. If the SPA/clients must reach the
   API directly, add external ingress in the AppHost (or front it with a gateway)
   before go-live.
2. **Postgres/Redis data is ephemeral.** Both run as plain container apps with no
   attached volume, so data does not survive a revision restart or scale event.
   For durable production data, move them to managed services
   (`AddAzurePostgresFlexibleServer` / `AddAzureRedis`) or attach persistent
   storage in the AppHost.

## Go-live runbook (gated CI deploy)

The production path is the **manually dispatched, environment-gated** workflow
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It is
isolated from the CI matrix so it can never run on — or fail — a pull request,
and it cannot read Azure credentials until a human approves the deployment.

Do these once, in order, before the first deploy:

1. **Create the protected `production` environment.** Repo → **Settings →
   Environments → New environment** → name it `production`. Add a **required
   reviewer** (Deployment protection rules → Required reviewers). This reviewer
   gate is the human approval step — the job pauses here on every run.
2. **Add the Azure identifiers as environment secrets** (Settings → Environments
   → `production` → Environment secrets):

   | Kind | Name | Purpose |
   |---|---|---|
   | Secret | `AZURE_CLIENT_ID` | App registration (service principal) client id |
   | Secret | `AZURE_TENANT_ID` | Entra tenant id |
   | Secret | `AZURE_SUBSCRIPTION_ID` | Target subscription id |

   No client **secret** is stored — sign-in is passwordless via OIDC (next step).
3. **Add a federated credential** so GitHub's OIDC token can log in with no
   stored secret. On the app registration (Entra → App registrations → your app →
   **Certificates & secrets → Federated credentials → Add**), or via
   `azd pipeline config --provider github`, create a credential with:

   | Field | Value |
   |---|---|
   | Issuer | `https://token.actions.githubusercontent.com` |
   | Subject | `repo:IEvangelist/cadence:environment:production` |
   | Audience | `api://AzureADTokenExchange` |

   The subject **must** match `environment:production` (not a branch/ref) because
   the workflow runs in the `production` environment. Grant the app registration
   the roles it needs on the subscription (e.g. **Contributor** + **RBAC
   Administrator**, or **Owner**) so azd can provision resources and assign the
   Storage/ACR roles above.
4. **Dispatch the deploy.** Actions → **Deploy (Azure Container Apps)** → **Run
   workflow**. Inputs default to `cadence-prod` / `eastus2`; override at dispatch
   time if needed. The run pauses for the required reviewer, then azd logs in via
   OIDC, creates/selects the environment, and runs `azd provision` + `azd deploy`.

> **No secrets are committed.** Credentials live only in the protected
> environment. `appsettings.json` ships empty auth/billing placeholders; supply
> real provider secrets through the environment or Key Vault (see
> [`docs/auth-setup.md`](../docs/auth-setup.md) and
> [`docs/billing-setup.md`](../docs/billing-setup.md)).

## Deploy from your machine (alternative — **provisions real resources**)

For a developer-owned environment outside CI. **This spends money** — it creates
the resources above in your subscription:

```bash
# One-time per environment
azd auth login
azd env new cadence-prod --location eastus2 --subscription <sub-id>

# Provision Azure resources + build and deploy the app
azd up
```

`azd up` = `azd provision` (infra) + `azd deploy` (app). Always tear it down when
you are done (see below).

## Cost overview

Costs are **pay-as-you-go** and depend on region, traffic, and data; the figures
below are rough idle-baseline drivers for a single low-traffic `eastus2`
environment. Use the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for
an authoritative estimate.

| Component | Billing model | Idle-baseline driver |
|---|---|---|
| Container Apps (Consumption) | Per vCPU-second + GiB-second + requests; generous monthly free grant | `api`, `postgres`, `redis` each run at **`minReplicas: 1`** (always-on, **no scale-to-zero**), so you pay a small steady floor even at zero traffic |
| Azure Container Registry (Basic) | Flat per-registry + storage | ~a few USD/month |
| Log Analytics (PerGB2018) | Per GB ingested + retention; first 5 GB/month free | Low single-digit USD at low log volume |
| Storage account (StorageV2, GRS, Hot) | Per GB stored (×2 for geo-redundancy) + transactions + egress | Pennies to a few USD for small blob volumes |
| Aspire dashboard component | No additional charge (runs in the environment) | — |

Ballpark: **single-digit to low double-digit USD/month at idle**, scaling with
traffic, log volume, and stored audio/assets. Two levers dominate the floor:

- The three `minReplicas: 1` container apps keep a baseline running. Lowering
  `minReplicas` to `0` (in the AppHost) lets idle apps scale to zero, but a
  scale-to-zero **database** loses its in-memory/ephemeral state — see the data
  persistence decision above.
- Moving Postgres/Redis to managed **Azure Database for PostgreSQL Flexible
  Server** / **Azure Cache for Redis** raises the floor (these are always-on,
  metered services) in exchange for durability, backups, and HA. `Standard_GRS`
  storage can drop to `Standard_LRS` if geo-redundancy isn't required.

## Teardown / cleanup

Delete **all** provisioned resources to stop billing:

```bash
# From the environment you deployed (deletes the resource group + purges resources)
azd down -e <env-name> --force --purge
```

If the azd environment is gone or you deployed via CI, delete the resource group
directly:

```bash
az group delete --name rg-<env-name> --yes --no-wait
# e.g. rg-cadence-prod
```

Then confirm nothing lingers (soft-deleted registries/workspaces, orphaned role
assignments) in the portal, and remove local state:

```bash
# Local-only cleanup — safe, no cloud calls
rm -rf .azure                              # local azd environment(s)
rm -rf infra/main.bicep infra/resources.bicep infra/main.parameters.json \
       infra/storage infra/storage-roles   # generated IaC (if you ran a validation)
rm -rf src/Cadence.AppHost/infra           # generated per-service ACA templates
```

`azd down` is safe to re-run; it is idempotent and no-ops once the resource group
is gone.

## Version pinning

Per [`docs/versioning-policy.md`](../docs/versioning-policy.md): every GitHub
Action in `deploy.yml` is pinned to a full commit SHA with a version comment, and
azd pins the Aspire/azd toolchain. Base container images resolved by azd inherit
the AppHost's pinned package versions.
