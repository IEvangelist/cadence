using Cadence.Api;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// OpenAPI document generation.
builder.Services.AddOpenApi();

// Throttle magic-link verification per target email so token guessing can't be
// amplified by volume (the primary volume control now that bad tokens no longer
// feed the shared account lockout — see VerifyMagicLinkAsync).
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
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
});

// Postgres-backed persistence (skipped in the Testing environment, where the
// test host registers an in-memory SQLite context instead).
builder.AddCadencePersistence();

// ASP.NET Core Identity, cookie auth, external OAuth, magic-link, tier claims.
builder.AddCadenceIdentity();

// Entitlement catalog + Stripe billing seams (checkout, portal, webhook).
builder.AddCadenceBilling();

var app = builder.Build();

// Maps /health and /alive (Development only). See ServiceDefaults.
app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Apply EF Core migrations at startup outside tests (the API waits for Postgres
// to be healthy first). Unit tests use SQLite + EnsureCreated in the test host.
if (!app.Environment.IsEnvironment("Testing"))
{
    await app.MigrateCadenceDatabaseAsync();
}

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/info", () => new ApiInfo("Cadence.Api", "0.0.0"))
    .WithName("GetApiInfo");

app.MapCadenceAuth();
app.MapCadenceProfile();
app.MapCadenceProjects();
app.MapCadenceBilling();

app.Run();

internal record ApiInfo(string Service, string Version);

// Exposed for WebApplicationFactory-based integration tests.
public partial class Program;
