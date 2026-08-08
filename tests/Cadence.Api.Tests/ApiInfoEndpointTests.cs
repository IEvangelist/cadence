using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

public class ApiInfoEndpointTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory = factory;

    [Fact]
    public async Task GetApiInfo_ReturnsOkWithServiceName()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/info");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var info = await response.Content.ReadFromJsonAsync<ApiInfoResponse>();

        Assert.NotNull(info);
        Assert.Equal("Cadence.Api", info!.Service);
    }

    private sealed record ApiInfoResponse(string Service, string Version);
}
