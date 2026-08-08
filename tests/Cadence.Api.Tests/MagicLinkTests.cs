using System.Net;
using System.Net.Http.Json;

namespace Cadence.Api.Tests;

public class MagicLinkTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private HttpClient CreateNonRedirectingClient() =>
        _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    [Fact]
    public async Task RequestMagicLink_ForNewUser_Returns202_AndCapturesToken()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.new@example.com"));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal("magic.new@example.com", _factory.MagicLinks.LastEmail);
        Assert.False(string.IsNullOrWhiteSpace(_factory.MagicLinks.LastToken));
    }

    [Fact]
    public async Task RequestMagicLink_DoesNotEnumerate_ForUnknownVsKnown()
    {
        // Both an existing and a brand-new address return the same 202 status.
        await _factory.CreateClient().RegisterAsync("magic.known@example.com");

        var known = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.known@example.com"));
        var unknown = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.unknown@example.com"));

        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
    }

    [Fact]
    public async Task VerifyMagicLink_WithValidToken_SignsIn()
    {
        var client = CreateNonRedirectingClient();

        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest("magic.verify@example.com"));
        var token = _factory.MagicLinks.LastToken!;

        var verify = await client.GetAsync(
            $"/api/auth/magic-link/verify?email={Uri.EscapeDataString("magic.verify@example.com")}" +
            $"&token={Uri.EscapeDataString(token)}");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=success", verify.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var identity = await me.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("magic.verify@example.com", identity!.Email);
    }

    [Fact]
    public async Task VerifyMagicLink_IsSingleUse()
    {
        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest("magic.once@example.com"));
        var token = _factory.MagicLinks.LastToken!;
        var url = $"/api/auth/magic-link/verify?email={Uri.EscapeDataString("magic.once@example.com")}" +
                  $"&token={Uri.EscapeDataString(token)}";

        var first = await client.GetAsync(url);
        var second = await _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        }).GetAsync(url);

        Assert.Contains("auth=success", first.Headers.Location!.ToString());
        Assert.Contains("auth=error", second.Headers.Location!.ToString());
    }

    [Fact]
    public async Task VerifyMagicLink_WithBadToken_RedirectsToError()
    {
        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest("magic.bad@example.com"));

        var verify = await client.GetAsync(
            $"/api/auth/magic-link/verify?email={Uri.EscapeDataString("magic.bad@example.com")}&token=not-a-token");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }

    [Fact]
    public async Task VerifyMagicLink_ForUnknownEmail_RedirectsToError()
    {
        var verify = await CreateNonRedirectingClient().GetAsync(
            "/api/auth/magic-link/verify?email=ghost@example.com&token=whatever");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }
}
