using Microsoft.Extensions.Configuration;

var builder = DistributedApplication.CreateBuilder(args);

// Relational store for projects, users, and metadata. Published as an Azure
// Database for PostgreSQL flexible server so production data survives
// container-app revision restarts (a plain container app has no durable volume).
// RunAsContainer keeps `aspire run` (and the integration-test harness) on a local
// Postgres container, so local dev needs no Azure resources.
var postgres = builder.AddAzurePostgresFlexibleServer("postgres")
    .RunAsContainer();
var cadenceDb = postgres.AddDatabase("cadencedb");

// Presence and caching. (Auth rate limiting is currently in-process per replica,
// not Redis-backed; cross-replica limiting is tracked as a follow-up.) Published
// as an Azure Cache for Redis (managed + durable), the offering #56 calls for;
// RunAsContainer keeps local dev on a Redis container.
//
// AddAzureRedis is [Obsolete] in Aspire 13.4.6, which now steers new code to
// AddAzureManagedRedis. That provisions the distinct (and pricier) "Azure Managed
// Redis" product, whereas #56 specifies "Azure Cache for Redis" and go-live cost
// is gated. We therefore keep AddAzureRedis deliberately and scope-suppress the
// obsolete warning rather than switch products; revisit if/when the API is removed.
#pragma warning disable CS0618 // Type or member is obsolete
var redis = builder.AddAzureRedis("redis")
    .RunAsContainer();
#pragma warning restore CS0618

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
    // Publish the API with an external (internet-facing) ingress so the GitHub
    // Pages SPA — a different origin from the container app — can reach it. Without
    // this the generated ACA app is internal-only. Cross-origin browser access is
    // then gated by the server-side CORS policy in Cadence.Api (Cors:AllowedOrigins).
    .WithExternalHttpEndpoints()
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
        var web = builder.AddNpmApp("web", "../../apps/web", "dev")
            .WithReference(api)
            .WaitFor(api)
            .WithHttpEndpoint(env: "PORT")
            .WithExternalHttpEndpoints();

        // The Tauri desktop shell (apps/desktop) as an optional, explicitly-started
        // resource that loads the Aspire-managed `web` dev server — NOT a second
        // Vite. apps/desktop/src-tauri/tauri.conf.json sets beforeDevCommand
        // "npm run dev:web" + devUrl http://localhost:5173, which would self-spawn a
        // backend-blind Vite (no PORT, no /api proxy, no service discovery) that can
        // also collide with `web`'s dynamic port. So we launch `tauri dev` with
        // beforeDevCommand disabled and devUrl overridden to `web`'s endpoint, wired
        // in via a reference expression so Tauri points at the same origin that
        // already proxies /api + the /api/collab WebSocket.
        //
        // It is nested inside the node_modules gate (so `web` always exists for the
        // reference and the Docker-only integration harness — which never installs
        // node_modules — never adds it) and additionally guarded by:
        //   - Run mode (inherited from the enclosing block) so it never enters the
        //     published/azd manifest; the desktop app ships via its own tauri build.
        //   - WithExplicitStart() so it stays not-started in the dashboard until a
        //     developer clicks Start, and never auto-launches (Tauri opens a native
        //     window and needs a display + the Rust toolchain, neither present in
        //     headless CI / the Aspire.Hosting.Testing run-mode harness).
        //   - The Rust toolchain (rustup/cargo) being present; otherwise we skip it
        //     with a one-line install hint, matching the `web` node_modules gate.
        if (DesktopPrerequisites.RustToolchainAvailable())
        {
            builder.AddNpmApp("desktop", "../../apps/desktop", "tauri")
                .WithReference(web)
                .WaitFor(web)
                .WithExplicitStart()
                .WithArgs(context =>
                {
                    // Runs `npm run tauri -- dev --config {json}`, i.e. `tauri dev`
                    // with beforeDevCommand cleared and devUrl pointed at `web`.
                    context.Args.Add("--");
                    context.Args.Add("dev");
                    context.Args.Add("--config");
                    context.Args.Add(ReferenceExpression.Create(
                        $"{{\"build\":{{\"beforeDevCommand\":\"\",\"devUrl\":\"{web.GetEndpoint("http")}\"}}}}"));
                });
        }
        else
        {
            Console.WriteLine(
                "[cadence] Skipping the 'desktop' resource: the Rust toolchain " +
                "(rustup/cargo) was not found. Install it from https://rustup.rs to " +
                "launch the Tauri shell under `aspire run`.");
        }
    }
    else
    {
        Console.WriteLine(
            "[cadence] Skipping the 'web' resource (and the 'desktop' shell that " +
            "loads it): node_modules is missing. Run `npm ci` at the repo root to " +
            "dev-serve the SPA under `aspire run`.");
    }
}

// Docs + marketing site (site/ Astro app) as an optional, explicitly-started
// resource. It is wired only in run mode so it never enters the published/azd
// manifest (the site ships via GitHub Pages, not Azure Container Apps), and
// WithExplicitStart() leaves it not-started in the dashboard until a developer
// clicks Start — which also keeps it from launching during the Docker-only
// integration tests. Unlike apps/web, site/ is not an npm-workspace member, so
// its dependencies are not hoisted to the repo root; run `npm ci` in site/ once
// to populate site/node_modules before starting the resource.
if (builder.ExecutionContext.IsRunMode)
{
    builder.AddNpmApp("docs-site", "../../site", "dev")
        .WithHttpEndpoint(env: "PORT")
        .WithExternalHttpEndpoints()
        .WithExplicitStart();
}

builder.Build().Run();

file static class DesktopPrerequisites
{
    // Detects whether the Rust toolchain (rustup/cargo) is available so the
    // optional `desktop` (Tauri) resource is only wired when it could actually
    // build. Tauri shells out to cargo, so cargo must be resolvable; we check the
    // PATH (how a normal rustup install exposes it) and fall back to the default
    // rustup home (~/.cargo/bin) in case PATH was not propagated to the AppHost.
    public static bool RustToolchainAvailable()
    {
        string[] names = OperatingSystem.IsWindows()
            ? ["cargo.exe", "cargo.cmd", "cargo.bat"]
            : ["cargo"];

        var path = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrEmpty(path))
        {
            foreach (var dir in path.Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(dir))
                {
                    continue;
                }

                if (ContainsExecutable(dir, names))
                {
                    return true;
                }
            }
        }

        var cargoHome = Environment.GetEnvironmentVariable("CARGO_HOME");
        if (string.IsNullOrEmpty(cargoHome))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrEmpty(home))
            {
                cargoHome = Path.Combine(home, ".cargo");
            }
        }

        return !string.IsNullOrEmpty(cargoHome)
            && ContainsExecutable(Path.Combine(cargoHome, "bin"), names);
    }

    private static bool ContainsExecutable(string directory, string[] names)
    {
        foreach (var name in names)
        {
            try
            {
                if (File.Exists(Path.Combine(directory, name)))
                {
                    return true;
                }
            }
            catch (ArgumentException)
            {
                // Ignore malformed PATH entries (invalid path characters).
            }
        }

        return false;
    }
}

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
