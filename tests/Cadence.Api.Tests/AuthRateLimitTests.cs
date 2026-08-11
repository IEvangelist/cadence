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
    public async Task MagicLinkSend_PerIp_PartitionsByForwardedClientIp()
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

        // Client A exhausts its own per-IP budget (2 permits).
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkFromAsync(client, "203.0.113.10", "fwd.a1@example.com"));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkFromAsync(client, "203.0.113.10", "fwd.a2@example.com"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkFromAsync(client, "203.0.113.10", "fwd.a3@example.com"));

        // Client B is a different forwarded IP -> independent budget, unaffected by A.
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkFromAsync(client, "203.0.113.20", "fwd.b1@example.com"));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkFromAsync(client, "203.0.113.20", "fwd.b2@example.com"));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkFromAsync(client, "203.0.113.20", "fwd.b3@example.com"));
    }

    [Fact]
    public async Task MagicLinkSend_PerIp_KeysOnRightmostHop_IgnoresSpoofedPrefix()
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

        // Same real client (right-most 203.0.113.50), attacker varies the spoofed
        // left-most entry each request. ForwardLimit=1 means only the right-most hop
        // (appended by the ingress in prod) is honored, so all three share ONE budget.
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkWithRawForwardedForAsync(client, "9.9.9.9, 203.0.113.50", "spoof.a1@example.com"));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkWithRawForwardedForAsync(client, "8.8.8.8, 203.0.113.50", "spoof.a2@example.com"));
        // Third request with yet another forged prefix is still rejected: the spoofed
        // left entry did NOT mint a fresh budget.
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkWithRawForwardedForAsync(client, "7.7.7.7, 203.0.113.50", "spoof.a3@example.com"));

        // A genuinely different right-most hop is a different client -> its own budget.
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkWithRawForwardedForAsync(client, "1.1.1.1, 203.0.113.60", "spoof.b1@example.com"));
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
    public async Task Login_PerIp_PartitionsByForwardedClientIp()
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

        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginFromAsync(client, "203.0.113.30", "fwd.login-a1@example.com")));
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginFromAsync(client, "203.0.113.30", "fwd.login-a2@example.com")));
        Assert.Equal(HttpStatusCode.TooManyRequests, (await LoginFromAsync(client, "203.0.113.30", "fwd.login-a3@example.com")));

        // Different forwarded IP -> its own budget, not tripped by client A.
        Assert.Equal(HttpStatusCode.Unauthorized, (await LoginFromAsync(client, "203.0.113.40", "fwd.login-b1@example.com")));
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

    // #75: under Azure Container Apps autoscale the per-email magic-link cap must be
    // GLOBAL across replicas, not enforced independently per instance. Two factories
    // sharing ONE counter store model two replicas sharing one Redis: the 3/hour
    // budget is consumed jointly and the 4th send is rejected on EITHER instance.
    [Fact]
    public async Task MagicLinkSendEmail_Cap_IsShared_AcrossApiInstances()
    {
        var sharedStore = new InMemoryRateLimitCounterStore();
        var config = new Dictionary<string, string?>
        {
            // Keep the per-IP budget out of the way; this test is about the per-email cap.
            ["RateLimiting:MagicLinkSend:PermitLimit"] = "100",
            ["RateLimiting:MagicLinkSend:WindowSeconds"] = "60",
            ["RateLimiting:MagicLinkSendEmail:PermitLimit"] = "3",
            ["RateLimiting:MagicLinkSendEmail:WindowSeconds"] = "3600",
        };
        await using var replicaA = new CadenceApiFactory { RateLimitCounterStore = sharedStore, ConfigOverrides = config };
        await using var replicaB = new CadenceApiFactory { RateLimitCounterStore = sharedStore, ConfigOverrides = config };
        var clientA = replicaA.CreateClient();
        var clientB = replicaB.CreateClient();
        const string email = "shared.cap@example.com";

        // Three sends are allowed across the two replicas combined.
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(clientA, email));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(clientB, email));
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(clientA, email));

        // The global budget is now exhausted: the 4th send is rejected on BOTH replicas.
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkAsync(clientB, email));
        Assert.Equal(HttpStatusCode.TooManyRequests, await SendMagicLinkAsync(clientA, email));

        // A different email still has its own full budget on either replica.
        Assert.Equal(HttpStatusCode.Accepted, await SendMagicLinkAsync(clientB, "shared.cap-other@example.com"));
    }

    private static async Task<HttpStatusCode> SendMagicLinkAsync(HttpClient client, string email)
    {
        using var response = await client.PostAsJsonAsync("/api/auth/magic-link", new MagicLinkRequest(email));
        return response.StatusCode;
    }

    private static async Task<HttpStatusCode> SendMagicLinkFromAsync(HttpClient client, string clientIp, string email)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/magic-link")
        {
            Content = JsonContent.Create(new MagicLinkRequest(email)),
        };
        request.Headers.Add("X-Forwarded-For", clientIp);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task<HttpStatusCode> SendMagicLinkWithRawForwardedForAsync(HttpClient client, string forwardedForHeader, string email)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/magic-link")
        {
            Content = JsonContent.Create(new MagicLinkRequest(email)),
        };
        request.Headers.TryAddWithoutValidation("X-Forwarded-For", forwardedForHeader);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static async Task<HttpStatusCode> LoginFromAsync(HttpClient client, string clientIp, string email)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new LoginRequest(email, "Wrong0rd!")),
        };
        request.Headers.Add("X-Forwarded-For", clientIp);
        using var response = await client.SendAsync(request);
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
