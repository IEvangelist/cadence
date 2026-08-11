using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;

namespace Cadence.Api.Tests;

// The production SPA is served from GitHub Pages (https://ievangelist.github.io),
// a different origin from the deployed API, so the API must answer cross-origin
// requests from that origin — including the browser's CORS preflight. These
// tests boot the API in-process (no Docker) and assert the CORS policy is wired
// into the middleware pipeline and honours Cors:AllowedOrigins.
public class CorsPolicyTests(CadenceApiFactory factory)
    : IClassFixture<CadenceApiFactory>
{
    private const string PagesOrigin = "https://ievangelist.github.io";

    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task Preflight_from_pages_origin_is_allowed()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/info");
        request.Headers.Add("Origin", PagesOrigin);
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        // ASP.NET Core short-circuits a valid preflight with 204 No Content.
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(PagesOrigin, Single(response, "Access-Control-Allow-Origin"));
        Assert.Equal("true", Single(response, "Access-Control-Allow-Credentials"));
        // The requested method is echoed back as allowed.
        Assert.Contains("GET", Single(response, "Access-Control-Allow-Methods"));
    }

    [Fact]
    public async Task Simple_get_from_pages_origin_carries_cors_headers()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        request.Headers.Add("Origin", PagesOrigin);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(PagesOrigin, Single(response, "Access-Control-Allow-Origin"));
        Assert.Equal("true", Single(response, "Access-Control-Allow-Credentials"));

        var info = await response.Content.ReadFromJsonAsync<ApiInfoResponse>();
        Assert.Equal("Cadence.Api", info!.Service);
    }

    [Fact]
    public async Task Disallowed_origin_gets_no_allow_origin_header()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        request.Headers.Add("Origin", "https://malicious.example");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(
            response.Headers.Contains("Access-Control-Allow-Origin"),
            "An origin outside Cors:AllowedOrigins must not receive an Access-Control-Allow-Origin header.");
    }

    private static string Single(HttpResponseMessage response, string header)
    {
        Assert.True(
            response.Headers.TryGetValues(header, out var values),
            $"Expected response header '{header}' to be present.");
        return Assert.Single(values!);
    }

    private sealed record ApiInfoResponse(string Service, string Version);
}

// Unit coverage for the configuration seam that drives the policy above. (The
// WebApplicationFactory harness applies config overrides only after the host is
// built, whereas the policy binds origins at build time, so the default-vs-
// configured distinction is asserted directly against the resolver here.)
public class CadenceCorsTests
{
    [Fact]
    public void ResolveAllowedOrigins_defaults_to_pages_origin_when_unset()
    {
        var configuration = new ConfigurationBuilder().Build();

        var origins = CadenceCors.ResolveAllowedOrigins(configuration);

        Assert.Equal([CadenceCors.DefaultOrigin], origins);
    }

    [Fact]
    public void ResolveAllowedOrigins_reads_configured_origins()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Cors:AllowedOrigins:0"] = "https://studio.contoso.test",
                ["Cors:AllowedOrigins:1"] = "https://preview.contoso.test",
            })
            .Build();

        var origins = CadenceCors.ResolveAllowedOrigins(configuration);

        Assert.Equal(
            ["https://studio.contoso.test", "https://preview.contoso.test"],
            origins);
    }
}
