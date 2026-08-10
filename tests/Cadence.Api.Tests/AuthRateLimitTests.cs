using System.Net;
using System.Net.Http.Json;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Cadence.Api.Tests;

public class AuthRateLimitTests
{
    [Fact]
    public async Task MagicLinkSend_IsRateLimited_PerEmail_AndPartitionsByEmail()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?>
            {
                ["RateLimiting:MagicLinkSend:PermitLimit"] = "100",
                ["RateLimiting:MagicLinkSend:WindowSeconds"] = "60",
                ["RateLimiting:MagicLinkSendEmail:PermitLimit"] = "2",
                ["RateLimiting:MagicLinkSendEmail:WindowSeconds"] = "3600",
            },
        };
        var client = factory.CreateClient();
        const string knownEmail = "send.known-limit@example.com";
        const string unknownEmail = "send.unknown-limit@example.com";
        await client.RegisterAsync(knownEmail);

        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, knownEmail));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, knownEmail));
        var knownThird = await SendMagicLinkAsync(client, knownEmail);
        var otherKnown = await SendMagicLinkAsync(client, "send.known-other@example.com");

        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, unknownEmail));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, unknownEmail));
        var unknownThird = await SendMagicLinkAsync(client, unknownEmail);
        var otherUnknown = await SendMagicLinkAsync(client, "send.unknown-other@example.com");

        Assert.Equal(HttpStatusCode.TooManyRequests, knownThird);
        Assert.Equal(HttpStatusCode.Accepted, otherKnown);
        Assert.Equal(HttpStatusCode.TooManyRequests, unknownThird);
        Assert.Equal(HttpStatusCode.Accepted, otherUnknown);
    }

    [Fact]
    public async Task MagicLinkSend_IsRateLimited_PerIp_IndependentOfEmail()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?>
            {
                ["RateLimiting:MagicLinkSend:PermitLimit"] = "2",
                ["RateLimiting:MagicLinkSend:WindowSeconds"] = "60",
                ["RateLimiting:MagicLinkSendEmail:PermitLimit"] = "100",
                ["RateLimiting:MagicLinkSendEmail:WindowSeconds"] = "3600",
            },
        };
        var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, "send.ip-1@example.com"));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(client, "send.ip-2@example.com"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkAsync(client, "send.ip-3@example.com"));
    }

    [Fact]
    public async Task Login_IsRateLimited_PerIp()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?>
            {
                ["RateLimiting:Login:PermitLimit"] = "2",
                ["RateLimiting:Login:WindowSeconds"] = "60",
            },
        };
        var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.LoginAsync("login.ip-1@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.LoginAsync("login.ip-2@example.com")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.LoginAsync("login.ip-3@example.com")).StatusCode);
    }

    [Fact]
    public async Task Login_UnknownUser_VerifiesDummyPasswordHash()
    {
        var spy = new CountingPasswordHasher();
        await using var factory = new CadenceApiFactory
        {
            PasswordHasher = spy,
        };
        var client = factory.CreateClient();
        await client.RegisterAsync("login.hash-known@example.com");

        spy.Reset();
        var known = await client.LoginAsync("login.hash-known@example.com", "Wrong0rd!");
        Assert.Equal(HttpStatusCode.Unauthorized, known.StatusCode);
        Assert.Equal(1, spy.VerifyCount);

        spy.Reset();
        var unknown = await client.LoginAsync("login.hash-unknown@example.com", "Wrong0rd!");
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(1, spy.VerifyCount);
    }

    private static async Task<HttpStatusCode> SendMagicLinkAsync(HttpClient client, string email)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        return response.StatusCode;
    }

    private sealed class CountingPasswordHasher : IPasswordHasher<ApplicationUser>
    {
        private readonly PasswordHasher<ApplicationUser> _inner = new();

        public int VerifyCount { get; private set; }

        public string HashPassword(ApplicationUser user, string password) =>
            _inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(
            ApplicationUser user,
            string hashedPassword,
            string providedPassword)
        {
            VerifyCount++;
            return _inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }

        public void Reset() => VerifyCount = 0;
    }
}
