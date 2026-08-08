var builder = WebApplication.CreateBuilder(args);

// Aspire service defaults: telemetry, health checks, service discovery, resilience.
builder.AddServiceDefaults();

// OpenAPI document generation.
builder.Services.AddOpenApi();

var app = builder.Build();

// Maps /health and /alive (Development only). See ServiceDefaults.
app.MapDefaultEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapGet("/api/info", () => new ApiInfo("Cadence.Api", "0.0.0"))
    .WithName("GetApiInfo");

app.Run();

internal record ApiInfo(string Service, string Version);

// Exposed for WebApplicationFactory-based integration tests.
public partial class Program;
