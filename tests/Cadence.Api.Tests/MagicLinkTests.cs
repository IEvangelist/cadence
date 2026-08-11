using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

public class MagicLinkTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private static HttpClient CreateNonRedirectingClient(CadenceApiFactory factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    private HttpClient CreateNonRedirectingClient() => CreateNonRedirectingClient(_factory);

    private static string VerifyUrl(string email, string token) =>
        $"/api/auth/magic-link/verify?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

    // Issue C: an unauthenticated request for an address with no account must NOT
    // create a user/profile (mass account-creation / email-squatting), but must
    // still return 202 so it can't be used to enumerate accounts.
    [Fact]
    public async Task RequestMagicLink_ForUnknownEmail_Returns202_ButCreatesNoAccount()
    {
        const string email = "magic.unknown-noacct@example.com";
        await using var factory = new CadenceApiFactory();
        var before = factory.AccountEmails.SentCount;

        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest(email));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await factory.WaitForEmailsAsync();
        Assert.False(await factory.UserExistsAsync(email), "no account should be created");
        Assert.Equal(before, factory.AccountEmails.SentCount);
    }

    // A malformed request that binds the email to null ({"email":null} / {}) must
    // return the same neutral 202 as any other send, not an unhandled 500.
    [Fact]
    public async Task RequestMagicLink_WithNullEmail_Returns202_NotServerError()
    {
        await using var factory = new CadenceApiFactory();

        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest(null!));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Fact]
    public async Task RequestMagicLink_ForExistingUser_SendsLink()
    {
        const string email = "magic.existing@example.com";
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync(email);
        var before = factory.AccountEmails.SentCount;

        var response = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest(email));

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await factory.WaitForEmailsAsync();
        Assert.Equal(before + 1, factory.AccountEmails.SentCount);
        Assert.Equal(email, factory.AccountEmails.LastEmail);
    }

    [Fact]
    public async Task RequestMagicLink_DoesNotEnumerate_ForUnknownVsKnown()
    {
        // Both an existing and a brand-new address return the same 202 status.
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync("magic.known@example.com");

        var known = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.known@example.com"));
        var unknown = await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.enum-unknown@example.com"));

        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, unknown.StatusCode);
    }

    // #77: the send timing side-channel is closed by deferring the existence-
    // dependent work (lookup + token generation + network send) to the background
    // dispatcher. This test proves the request path performs EQUIVALENT work for
    // both a known and an unknown address: each enqueues exactly one job. The
    // observable outcome still differs (only the known address is actually sent to),
    // but that difference no longer shows up as request latency.
    [Fact]
    public async Task RequestMagicLink_KnownAndUnknown_EnqueueEquivalentWork()
    {
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync("magic.timing-known@example.com");
        await factory.WaitForEmailsAsync();

        var dispatcher = factory.Services.GetRequiredService<AccountEmailDispatcher>();

        var beforeKnown = dispatcher.EnqueuedCount;
        await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.timing-known@example.com"));
        var knownEnqueued = dispatcher.EnqueuedCount - beforeKnown;

        var beforeUnknown = dispatcher.EnqueuedCount;
        await factory.CreateClient().PostAsJsonAsync(
            "/api/auth/magic-link", new MagicLinkRequest("magic.timing-unknown@example.com"));
        var unknownEnqueued = dispatcher.EnqueuedCount - beforeUnknown;

        Assert.Equal(1, knownEnqueued);
        Assert.Equal(1, unknownEnqueued);

        await factory.WaitForEmailsAsync();
        Assert.Equal(1, factory.AccountEmails.SentCount);
        Assert.Equal("magic.timing-known@example.com", factory.AccountEmails.LastEmail);
    }

    // Issue A: the URL-delivered token must be a high-entropy opaque value, NOT a
    // short numeric TOTP code that is feasible to brute-force.
    [Fact]
    public async Task MagicLinkToken_IsOpaque_NotSixDigitCode()
    {
        const string email = "magic.opaque@example.com";
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync(email);

        await factory.CreateClient().PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        await factory.WaitForEmailsAsync();
        var token = factory.AccountEmails.LastToken!;

        Assert.True(token.Length > 20, $"token should be long/opaque but was '{token}'");
        Assert.Contains(token, t => !char.IsDigit(t));
    }

    [Fact]
    public async Task VerifyMagicLink_WithValidToken_SignsIn()
    {
        const string email = "magic.verify@example.com";
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient(factory);
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        await factory.WaitForEmailsAsync();
        var token = factory.AccountEmails.LastToken!;

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
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient(factory);
        await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        await factory.WaitForEmailsAsync();
        var token = factory.AccountEmails.LastToken!;
        var url = VerifyUrl(email, token);

        var first = await client.GetAsync(url);
        var second = await CreateNonRedirectingClient(factory).GetAsync(url);

        Assert.Contains("auth=success", first.Headers.Location!.ToString());
        Assert.Contains("auth=error", second.Headers.Location!.ToString());
    }

    // NEW-1: bad magic-link tokens must NOT feed the shared Identity lockout
    // counter, otherwise an unauthenticated attacker who knows a victim's email
    // could lock the victim out of password sign-in (DoS). After several bad
    // magic-link verifies, the correct password still logs the user in.
    [Fact]
    public async Task VerifyMagicLink_BadTokens_DoNotLock_PasswordLogin()
    {
        const string email = "magic.nolockdos@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient();
        for (var i = 0; i < 6; i++)
        {
            var bad = await client.GetAsync(VerifyUrl(email, $"wrong-token-{i}"));
            Assert.Contains("auth=error", bad.Headers.Location!.ToString());
        }

        // The account must not be locked: password login with the right password works.
        var login = await _factory.CreateClient().LoginAsync(email);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    // Issue A volume control (now via the rate limiter, not lockout): once the
    // per-email budget is exhausted the verify endpoint returns 429.
    [Fact]
    public async Task VerifyMagicLink_IsRateLimited_AfterTooManyAttempts()
    {
        const string email = "magic.ratelimit@example.com";
        await _factory.CreateClient().RegisterAsync(email);

        var client = CreateNonRedirectingClient();
        HttpResponseMessage? limited = null;
        for (var i = 0; i < 15; i++)
        {
            var resp = await client.GetAsync(VerifyUrl(email, $"junk-{i}"));
            if (resp.StatusCode == HttpStatusCode.TooManyRequests)
            {
                limited = resp;
                break;
            }
        }

        Assert.NotNull(limited);
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
        await shortLived.WaitForEmailsAsync();
        var token = shortLived.AccountEmails.LastToken!;

        await Task.Delay(1000);

        var verify = await client.GetAsync(VerifyUrl(email, token));

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
    }

    [Fact]
    public async Task VerifyMagicLink_WithBadToken_RedirectsToError()
    {
        const string email = "magic.bad@example.com";
        await using var factory = new CadenceApiFactory();
        await factory.CreateClient().RegisterAsync(email);
        var client = CreateNonRedirectingClient(factory);
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
