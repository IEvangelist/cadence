using Cadence.Api;

var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// OpenAPI document generation.
builder.Services.AddOpenApi();

// Postgres-backed persistence (skipped in the Testing environment, where the
// test host registers an in-memory SQLite context instead).
builder.AddCadencePersistence();

// ASP.NET Core Identity, cookie auth, external OAuth, magic-link, tier claims.
builder.AddCadenceIdentity();

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

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/info", () => new ApiInfo("Cadence.Api", "0.0.0"))
    .WithName("GetApiInfo");

app.MapCadenceAuth();
app.MapCadenceProfile();
app.MapCadenceProjects();

app.Run();

internal record ApiInfo(string Service, string Version);

// Exposed for WebApplicationFactory-based integration tests.
public partial class Program;
