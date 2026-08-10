using Microsoft.Extensions.Configuration;

var builder = DistributedApplication.CreateBuilder(args);

// Relational store for projects, users, and metadata.
var postgres = builder.AddPostgres("postgres");
var cadenceDb = postgres.AddDatabase("cadencedb");

// Presence and caching. (Auth rate limiting is currently in-process per replica,
// not Redis-backed; cross-replica limiting is tracked as a follow-up.)
var redis = builder.AddRedis("redis");

// Audio/asset blob storage, backed by the Azurite emulator in development.
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var blobs = storage.AddBlobs("blobs");

// The `api` project also hosts the live-collaboration relay: an in-process
// WebSocket endpoint at /api/collab/{projectId} that fans out Yjs CRDT updates
// and awareness between collaborators. It is a first-party service (not a
// separate y-websocket container) because each connection's role is authorized
// server-side against the identity cookie (#7) and the projects/share-link
// tables — see CollaborationEndpoints. No extra resource, image, or secret is
// required; it rides on the existing API reference and database.
var api = builder.AddProject<Projects.Cadence_Api>("api")
    .WithReference(cadenceDb)
    .WaitFor(cadenceDb)
    .WithReference(redis)
    .WaitFor(redis)
    .WithReference(blobs)
    .WaitFor(blobs)
    .WithBillingConfiguration(builder.Configuration);

// Background stem-separation worker: consumes queued jobs, runs the separation
// engine, and writes labeled stems back to Blob storage. It shares the Postgres
// and Blob resources with the API and needs no inbound traffic of its own.
builder.AddProject<Projects.Cadence_SeparationWorker>("separation")
    .WithReference(cadenceDb)
    .WaitFor(cadenceDb)
    .WithReference(blobs)
    .WaitFor(blobs);

// The Vite/React SPA (apps/web) — the developer-facing UI that makes `aspire run`
// a one-command experience. It is added only when BOTH conditions hold:
//   1. Run mode — the published manifest intentionally has no `web` resource (the
//      SPA ships via its own build/Tauri packaging), so this block is skipped when
//      generating the manifest (IsRunMode is false there).
//   2. The repo-root node_modules is present — `npm run dev` (Vite) needs
//      installed dependencies, which npm workspaces hoist to the repo root.
//      Gating on this both documents `npm ci` as the one-time prerequisite and
//      keeps `web` out of the backend integration-test harness:
//      Aspire.Hosting.Testing also runs in run mode, but that Docker-only job
//      never installs the web deps, so it must not try to launch Vite.
// It waits for the API and reaches it same-origin through a Vite dev proxy (see
// apps/web/vite.config.ts) so the SPA's relative /api/* calls and the /api/collab
// WebSocket need no CORS. Aspire assigns the listen port via the PORT env var and
// injects the API address via service discovery (WithReference).
var repoRoot = Path.Combine(builder.AppHostDirectory, "..", "..");
if (builder.ExecutionContext.IsRunMode)
{
    if (Directory.Exists(Path.Combine(repoRoot, "node_modules")))
    {
        builder.AddNpmApp("web", "../../apps/web", "dev")
            .WithReference(api)
            .WaitFor(api)
            .WithHttpEndpoint(env: "PORT")
            .WithExternalHttpEndpoints();
    }
    else
    {
        Console.WriteLine(
            "[cadence] Skipping the 'web' resource: node_modules is missing. " +
            "Run `npm ci` at the repo root to dev-serve the SPA under `aspire run`.");
    }
}

builder.Build().Run();

file static class BillingConfigurationExtensions
{
    // Stripe billing settings are supplied out-of-band (AppHost user-secrets /
    // deployment params) and forwarded to the API only when present, so nothing is
    // required for a local run and no secrets are ever committed. The integration
    // tests inject a webhook secret via command-line configuration to drive a
    // signed webhook end-to-end.
    private static readonly string[] BillingKeys =
    [
        "Billing:Stripe:SecretKey",
        "Billing:Stripe:PublishableKey",
        "Billing:Stripe:WebhookSecret",
        "Billing:Stripe:PriceId",
        "Billing:SuccessUrl",
        "Billing:CancelUrl",
        "Billing:PortalReturnUrl",
    ];

    public static IResourceBuilder<ProjectResource> WithBillingConfiguration(
        this IResourceBuilder<ProjectResource> api,
        IConfiguration configuration)
    {
        foreach (var key in BillingKeys)
        {
            var value = configuration[key];
            if (!string.IsNullOrEmpty(value))
            {
                api.WithEnvironment(key.Replace(":", "__"), value);
            }
        }

        return api;
    }
}
