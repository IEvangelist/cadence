using System.Net;
using System.Net.Http.Json;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace Cadence.Api.IntegrationTests;

// Boots the real Aspire app graph (API + Postgres + Redis + Azurite blob) via
// Aspire.Hosting.Testing and asserts the API's contract surface is reachable
// once every dependency is healthy. Requires a container runtime (Docker),
// so it is tagged Integration and runs in its own CI job.
[Trait("Category", "Integration")]
public class AppHostIntegrationTests
{
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromMinutes(5);

    [Fact]
    public async Task Api_exposes_health_liveness_info_and_openapi()
    {
        var appHost = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.Cadence_AppHost>();

        await using var app = await appHost.BuildAsync();
        await app.StartAsync();

        // The API WaitsFor Postgres/Redis/Blob, so healthy means the whole
        // dependency chain came up.
        await app.ResourceNotifications
            .WaitForResourceHealthyAsync("api")
            .WaitAsync(ReadyTimeout);

        var client = app.CreateHttpClient("api");

        var health = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);

        var alive = await client.GetAsync("/alive");
        Assert.Equal(HttpStatusCode.OK, alive.StatusCode);

        var info = await client.GetFromJsonAsync<ApiInfo>("/api/info");
        Assert.NotNull(info);
        Assert.Equal("Cadence.Api", info!.Service);

        var openApi = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, openApi.StatusCode);

        var document = await openApi.Content.ReadAsStringAsync();
        Assert.Contains("/api/info", document);
    }

    private sealed record ApiInfo(string Service, string Version);
}
