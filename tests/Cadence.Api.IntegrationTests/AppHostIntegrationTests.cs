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

        // Cadence APIs ship with the Scalar reference UI (ApiDocs:Enabled, default
        // true) served in every environment; confirm it renders over the document.
        var scalar = await client.GetAsync("/scalar");
        Assert.Equal(HttpStatusCode.OK, scalar.StatusCode);
    }

    [Fact]
    public async Task Register_then_create_project_persists_against_real_postgres()
    {
        var appHost = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.Cadence_AppHost>();

        await using var app = await appHost.BuildAsync();
        await app.StartAsync();

        await app.ResourceNotifications
            .WaitForResourceHealthyAsync("api")
            .WaitAsync(ReadyTimeout);

        // A cookie-aware client so the auth cookie set by /register flows into the
        // subsequent authorized /projects calls. Reaching the DB proves the
        // startup EF Core migrations applied to the real Postgres instance.
        var baseAddress = app.GetEndpoint("api");
        using var handler = new HttpClientHandler
        {
            UseCookies = true,
            CookieContainer = new CookieContainer(),
            AllowAutoRedirect = false,
        };
        using var client = new HttpClient(handler) { BaseAddress = baseAddress };

        var register = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "integration.user@example.com",
            password = "Passw0rd!",
            displayName = "Integration User",
        });
        // #76: registration is neutral (202, no cookie); sign-in is a separate step.
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "integration.user@example.com",
            password = "Passw0rd!",
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        await client.AddAntiforgeryAsync();

        var create = await client.PostAsJsonAsync("/api/projects", new
        {
            name = "Persisted Song",
            schemaVersion = 1,
            data = "{\"tracks\":[]}",
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<ProjectDto>();
        Assert.Equal("Persisted Song", created!.Name);

        // Read it back through a fresh request to confirm it round-tripped to Postgres.
        var fetched = await client.GetFromJsonAsync<ProjectDto>($"/api/projects/{created.Id}");
        Assert.Equal(created.Id, fetched!.Id);
        Assert.Equal("Persisted Song", fetched.Name);

        var list = await client.GetFromJsonAsync<List<ProjectSummaryDto>>("/api/projects");
        Assert.Contains(list!, p => p.Id == created.Id);
    }

    private sealed record ApiInfo(string Service, string Version);

    private sealed record ProjectDto(string Id, string Name, int SchemaVersion, string Data);

    private sealed record ProjectSummaryDto(string Id, string Name, int SchemaVersion);
}
