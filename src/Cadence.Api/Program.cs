using Cadence.Api;
using Microsoft.AspNetCore.HttpOverrides;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// OpenAPI document generation.
builder.Services.AddOpenApi();

// Throttle the auth entry points before they reach Identity. Backed by the
// Aspire-referenced Redis when present so the limits are GLOBAL across Azure
// Container Apps replicas (see CadenceRateLimitingExtensions / #75).
builder.AddCadenceRateLimiting();

// Cross-origin access for the browser SPA. In production the SPA is served from
// GitHub Pages (https://ievangelist.github.io) — a different origin from the
// deployed API — so the API must opt that origin into credentialed CORS
// (the identity cookie flows with the cross-origin API/WebSocket calls). The
// allowed origins are configurable via Cors:AllowedOrigins and default to the
// public Pages origin; credentials require explicit origins (never a wildcard).
var corsAllowedOrigins = CadenceCors.ResolveAllowedOrigins(builder.Configuration);
builder.Services.AddCors(options =>
{
    options.AddPolicy(CadenceCors.PolicyName, policy => policy
        .WithOrigins(corsAllowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// Postgres-backed persistence (skipped in the Testing environment, where the
// test host registers an in-memory SQLite context instead).
builder.AddCadencePersistence();

// ASP.NET Core Identity, cookie auth, external OAuth, magic-link, tier claims.
builder.AddCadenceIdentity();

// Entitlement catalog + Stripe billing seams (checkout, portal, webhook).
builder.AddCadenceBilling();

// In-memory hub backing the collaboration WebSocket relay (per-project rooms).
builder.Services.AddSingleton<Cadence.Api.Collaboration.CollabHub>();

// Durable server-side persistence for each room's Yjs document, so a room
// survives all peers disconnecting and reconnects with state intact.
builder.Services.AddSingleton<Cadence.Api.Collaboration.ICollabDocumentStore, Cadence.Api.Collaboration.EfCollabDocumentStore>();

// Stem separation: options + (outside Testing) Blob-backed stem storage.
builder.AddCadenceStems();

var app = builder.Build();

// Maps /health and /alive (Development only). See ServiceDefaults.
app.MapDefaultEndpoints();
app.UseCadenceTelemetry();

// API reference documentation: the OpenAPI document plus the human-facing Scalar
// reference UI. Cadence APIs ship with Scalar, so this is enabled in every
// environment by default; operators can turn it off (for example in production)
// by setting ApiDocs:Enabled=false. Scalar reads the app's OpenAPI JSON at
// /openapi/v1.json and renders the interactive reference at /scalar.
if (app.Configuration.GetValue("ApiDocs:Enabled", true))
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Apply EF Core migrations at startup outside tests (the API waits for Postgres
// to be healthy first). Unit tests use SQLite + EnsureCreated in the test host.
if (!app.Environment.IsEnvironment("Testing"))
{
    await app.MigrateCadenceDatabaseAsync();
}

// Behind the Azure Container Apps ingress (Envoy) the socket peer is the ingress,
// not the caller, so the real client IP arrives in X-Forwarded-For. Resolve it
// before rate limiting so the per-IP limiters partition by client rather than by
// the shared ingress address (which would degrade them into global limiters).
//
// Trust scope: ForwardLimit = 1 honours ONLY the right-most XFF entry, which the
// ingress appends with the true downstream peer IP. A caller that pre-seeds
// X-Forwarded-For therefore cannot spoof its address to dodge or poison another
// client's budget — its forged entries sit to the left of the ingress-appended
// real IP and are never read. KnownNetworks/KnownProxies are cleared because the
// ingress IP is assigned dynamically and is not knowable ahead of time; the
// single-hop limit (not a fixed proxy allow-list) is what enforces the boundary.
// This assumes the app is reachable only via the ingress, which is true for the
// azd container-app deployment.
var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1,
};
forwardedHeadersOptions.KnownIPNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

// Emit CORS headers (and short-circuit preflight) before rate limiting and auth
// so the GitHub Pages SPA can reach the API from its own origin. Applies the
// named policy configured from Cors:AllowedOrigins above.
app.UseCors(CadenceCors.PolicyName);

app.UseRateLimiter();
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/info", () => new ApiInfo("Cadence.Api", "0.0.0"))
    .WithName("GetApiInfo");

app.MapCadenceAuth();
app.MapCadenceProfile();
app.MapCadenceProjects();
app.MapCadenceCollaboration();
app.MapCadenceBilling();
app.MapCadenceStems();

app.Run();

internal record ApiInfo(string Service, string Version);

// Exposed for WebApplicationFactory-based integration tests.
public partial class Program;
