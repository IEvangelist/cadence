using Cadence.Api;
using Scalar.AspNetCore;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// OpenAPI document generation.
builder.Services.AddOpenApi();

builder.Services.AddKeyedSingleton<PartitionedRateLimiter<string>>(
    AuthEndpoints.MagicLinkSendEmailLimiterKey,
    (services, _) =>
    {
        var configuration = services.GetRequiredService<IConfiguration>();
        var permitLimit = configuration.GetValue("RateLimiting:MagicLinkSendEmail:PermitLimit", 3);
        var window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:MagicLinkSendEmail:WindowSeconds", 3600));
        return PartitionedRateLimiter.Create<string, string>(partitionKey =>
            RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
            }));
    });

// Throttle auth entry points before they reach Identity. Magic-link verification
// is keyed by target email because token guessing volume should be bounded per
// victim address; send/login also receive IP-scoped middleware limits.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(AuthEndpoints.MagicLinkSendRateLimitPolicy, context =>
    {
        var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
        var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = configuration.GetValue("RateLimiting:MagicLinkSend:PermitLimit", 5),
            Window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:MagicLinkSend:WindowSeconds", 60)),
            QueueLimit = 0,
        });
    });
    options.AddPolicy(AuthEndpoints.MagicLinkVerifyRateLimitPolicy, context =>
    {
        // Normalize the email so casing/whitespace variants (Victim@x vs victim@x)
        // share one budget instead of each getting an independent 10/min window.
        var email = context.Request.Query["email"].ToString();
        var partitionKey = string.IsNullOrWhiteSpace(email)
            ? "anonymous"
            : email.Trim().ToLowerInvariant();
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        });
    });
    options.AddPolicy(AuthEndpoints.LoginRateLimitPolicy, context =>
    {
        var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
        var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(partitionKey, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = configuration.GetValue("RateLimiting:Login:PermitLimit", 10),
            Window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:Login:WindowSeconds", 60)),
            QueueLimit = 0,
        });
    });
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
