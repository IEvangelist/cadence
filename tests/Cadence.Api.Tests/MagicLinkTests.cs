using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

public class MagicLinkTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private HttpClient CreateNonRedirectingClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    private static string VerifyUrl(string email, string token) =>
        $"/api/auth/magic-link/verify?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

    // Issue C: an unauthenticated request for an address with no account must NOT
    // create a user/profile (mass account-creation / email-squatting), but must
    // still return 202 so it can't be used to enumerate accounts.
    [Fact]
    public async Task RequestMagicLink_ForUnknownEmail_Returns202_ButCreatesNoAccount()
    {
        const string email = "magic.unknown-noacct@example.com";
        var before = _factory.MagicLinks.SentCount;

        var response = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest(email));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.False(await _factory.UserExistsAsync(email), "no account should be created");
        Assert.Equal(before, _factory.MagicLinks.SentCount);
    }

    [Fact]
    public async Task RequestMagicLink_ForExistingUser_SendsLink()
    {
        const string email = "magic.existing@example.com";
        await _factory.CreateClient().RegisterAsync(email);
        var before = _factory.MagicLinks.SentCount;

        var response = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest(email));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Equal(before + 1, _factory.MagicLinks.SentCount);
        Assert.Equal(email, _factory.MagicLinks.LastEmail);
    }

    [Fact]
    public async Task RequestMagicLink_DoesNotEnumerate_ForUnknownVsKnown()
    {
        // Both an existing and a brand-new address return the same 202 status.
        await _factory.CreateClient().RegisterAsync("magic.known@example.com");

        var known = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.known@example.com"));
        var unknown = await _factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.enum-unknown@example.com"));

        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
    }

    // Issue A: the URL-delivered token must be a high-entropy opaque value, NOT a
    // short numeric TOTP code that is feasible to brute-force.
    [Fact]
    public async Task MagicLinkToken_IsOpaque_NotSixDigitCode()
    {
        const string email = "magic.opaque@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        await _factory.CreateClient().PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        var token = _factory.MagicLinks.LastToken!;

        Assert.True(token.Length > 20, $"token should be long/opaque but was '{token}'");
        Assert.Contains(token, t => !char.IsDigit(t));
    }

    [Fact]
    public async Task VerifyMagicLink_WithValidToken_SignsIn()
    {
        const string email = "magic.verify@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        var token = _factory.MagicLinks.LastToken!;

        var verify = await client.GetAsync(VerifyUrl(email, token));

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=success", verify.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var identity = await me.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal(email, identity!.Email);
    }

    // Issue A (d): a token cannot be replayed once used.
    [Fact]
    public async Task VerifyMagicLink_IsSingleUse()
    {
        const string email = "magic.once@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        var token = _factory.MagicLinks.LastToken!;
        var url = VerifyUrl(email, token);

        var first = await client.GetAsync(url);
        var second = await CreateNonRedirectingClient().GetAsync(url);

        Assert.Contains("auth=success", first.Headers.Location!.ToString());
        Assert.Contains("auth=error", second.Headers.Location!.ToString());
    }

    // Issue A (b): repeated wrong tokens lock the account so even a valid token is
    // rejected afterward — brute-force guessing can't be sustained.
    [Fact]
    public async Task VerifyMagicLink_LocksOut_AfterRepeatedBadTokens()
    {
        const string email = "magic.lockout@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        var validToken = _factory.MagicLinks.LastToken!;

        for (var i = 0; i < 5; i++)
        {
            var bad = await client.GetAsync(VerifyUrl(email, $"wrong-token-{i}"));
            Assert.Contains("auth=error", bad.Headers.Location!.ToString());
        }

        // Even the genuine token is now refused because the account is locked.
        var locked = await client.GetAsync(VerifyUrl(email, validToken));
        Assert.Contains("auth=error", locked.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    // Issue A (c): an expired token is rejected.
    [Fact]
    public async Task VerifyMagicLink_WithExpiredToken_RedirectsToError()
    {
        const string email = "magic.expired@example.com";
        await using var shortLived = new CadenceApiFactory
        {
            MagicLinkTokenLifespan = TimeSpan.FromMilliseconds(1),
        };
        await shortLived.CreateClient().RegisterAsync(email);

        var client = shortLived.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        var token = shortLived.MagicLinks.LastToken!;

        await Task.Delay(1000);

        var verify = await client.GetAsync(VerifyUrl(email, token));

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }

    [Fact]
    public async Task VerifyMagicLink_WithBadToken_RedirectsToError()
    {
        const string email = "magic.bad@example.com";
        await _factory.CreateClient().RegisterAsync(email);
        var client = CreateNonRedirectingClient();
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));

        var verify = await client.GetAsync(VerifyUrl(email, "not-a-token"));

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }

    [Fact]
    public async Task VerifyMagicLink_ForUnknownEmail_RedirectsToError()
    {
        var verify = await CreateNonRedirectingClient().GetAsync(
            VerifyUrl("ghost@example.com", "whatever"));

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }
}
