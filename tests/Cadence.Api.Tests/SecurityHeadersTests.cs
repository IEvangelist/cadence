using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

/// <summary>
/// The API is internet-facing (Aspire <c>WithExternalHttpEndpoints()</c>), so every
/// response must carry baseline hardening headers and, outside Development, assert
/// HSTS over HTTPS. These tests boot the API in-process (the non-Development
/// "Testing" host) and drive the real middleware pipeline.
/// </summary>
public class SecurityHeadersTests(CadenceApiFactory factory)
    : IClassFixture<CadenceApiFactory>
{
    private const string PagesOrigin = "https://ievangelist.github.io";

    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task Successful_responses_carry_sniffing_and_framing_headers()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/info");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("nosniff", Header(response, "X-Content-Type-Options"));
        Assert.Equal("DENY", Header(response, "X-Frame-Options"));
        Assert.Equal("frame-ancestors 'none'", Header(response, "Content-Security-Policy"));
    }

    [Fact]
    public async Task Not_found_responses_also_carry_hardening_headers()
    {
        var client = _factory.CreateClient();

        // Docs are off in the non-Development test host, so this path 404s — proving
        // the headers apply to every response, not just successful ones.
        var response = await client.GetAsync("/openapi/v1.json");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("nosniff", Header(response, "X-Content-Type-Options"));
        Assert.Equal("DENY", Header(response, "X-Frame-Options"));
        Assert.Equal("frame-ancestors 'none'", Header(response, "Content-Security-Policy"));
    }

    [Fact]
    public async Task Hsts_is_emitted_for_https_requests_outside_development()
    {
        // HSTS's default ExcludedHosts skips localhost, so exercise a non-localhost
        // host over HTTPS. The non-Development test host wires UseHsts, so the header
        // is asserted.
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://api.cadence.test"),
        });

        var response = await client.GetAsync("/api/info");

        Assert.True(
            response.Headers.Contains("Strict-Transport-Security"),
            "HSTS must be asserted on HTTPS requests outside Development.");
    }

    [Fact]
    public async Task Hsts_is_not_emitted_over_plain_http()
    {
        // The default client speaks plain HTTP (the local/dev/test hop), where HSTS
        // must never fire.
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/info");

        Assert.False(
            response.Headers.Contains("Strict-Transport-Security"),
            "HSTS must not be emitted over the plain-HTTP hop.");
    }

    [Fact]
    public async Task Cors_preflight_still_succeeds_and_carries_hardening_headers()
    {
        var client = _factory.CreateClient();

        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/info");
        request.Headers.Add("Origin", PagesOrigin);
        request.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await client.SendAsync(request);

        // The hardening middleware runs before CORS; it must not break the preflight
        // short-circuit, and its headers ride along on the 204.
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(PagesOrigin, Header(response, "Access-Control-Allow-Origin"));
        Assert.Equal("nosniff", Header(response, "X-Content-Type-Options"));
        Assert.Equal("DENY", Header(response, "X-Frame-Options"));
    }

    // Response security headers surface on HttpResponseMessage.Headers, but guard
    // against any that HttpClient chooses to file under Content.Headers.
    private static string Header(HttpResponseMessage response, string name)
    {
        if (response.Headers.TryGetValues(name, out var values) ||
            (response.Content is { } content && content.Headers.TryGetValues(name, out values)))
        {
            return Assert.Single(values!);
        }

        Assert.Fail($"Expected response header '{name}' to be present.");
        return string.Empty; // unreachable; Assert.Fail throws.
    }
}
