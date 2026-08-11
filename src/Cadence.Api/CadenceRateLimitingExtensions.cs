using System.Threading.RateLimiting;
using Cadence.Api.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Cadence.Api;

/// <summary>
/// Registers the auth rate limiters. When the Aspire-referenced Redis is present
/// the limiters share ONE budget across every API replica (see #75); without it
/// they fall back to the original in-process fixed-window limiters, so unit tests
/// and single-node runs behave exactly as before.
/// </summary>
public static class CadenceRateLimitingExtensions
{
    /// <summary>
    /// Add the per-email magic-link send limiter plus the per-IP send/login and
    /// per-email verify middleware policies, backing them with Redis when available.
    /// </summary>
    public static IHostApplicationBuilder AddCadenceRateLimiting(this IHostApplicationBuilder builder)
    {
        var services = builder.Services;

        // Presence of the "redis" connection string (injected by the AppHost's
        // .WithReference(redis)) is what switches the limiters from in-process to
        // distributed. Gating on the connection string rather than the environment
        // keeps production on Redis, unit tests on the in-memory fallback, and lets
        // an integration test opt in by pointing at a real Redis.
        var redisConnectionString = builder.Configuration.GetConnectionString("redis");
        if (!string.IsNullOrWhiteSpace(redisConnectionString))
        {
            // Registers IConnectionMultiplexer (AbortOnConnectFail=false) wired to
            // the "redis" resource; the counter store consumes it.
            builder.AddRedisClient("redis");
            services.AddSingleton<IRateLimitCounterStore, RedisRateLimitCounterStore>();
        }

        // Per-email magic-link SEND cap (the email-bomb defense) — a keyed limiter
        // acquired directly inside the handler. This is the security-sensitive cap
        // #75 most cares about being GLOBAL across replicas, so it fails CLOSED if
        // Redis is momentarily unavailable.
        services.AddKeyedSingleton<PartitionedRateLimiter<string>>(
            AuthEndpoints.MagicLinkSendEmailLimiterKey,
            (serviceProvider, _) =>
            {
                var configuration = serviceProvider.GetRequiredService<IConfiguration>();
                var store = serviceProvider.GetService<IRateLimitCounterStore>();
                var permitLimit = configuration.GetValue("RateLimiting:MagicLinkSendEmail:PermitLimit", 3);
                var window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:MagicLinkSendEmail:WindowSeconds", 3600));
                return PartitionedRateLimiter.Create<string, string>(partitionKey =>
                    RateLimitPartition.Get(partitionKey, key =>
                        CadenceRateLimiterFactory.FixedWindow(store, "mlsend-email", key, permitLimit, window, failOpen: false)));
            });

        // Throttle auth entry points before they reach Identity. Magic-link verify
        // is keyed by target email (bound token-guessing volume per victim); send and
        // login also receive IP-scoped middleware limits. The per-IP throttles fail
        // OPEN on Redis trouble so a blip can't lock everyone out of sign-in.
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.AddPolicy(AuthEndpoints.MagicLinkSendRateLimitPolicy, context =>
            {
                var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
                var store = context.RequestServices.GetService<IRateLimitCounterStore>();
                // Proxy-resolved client IP (see UseForwardedHeaders); ingress IP in prod
                // without it. "unknown" only when no peer/XFF is present (in-proc tests).
                var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                var permitLimit = configuration.GetValue("RateLimiting:MagicLinkSend:PermitLimit", 5);
                var window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:MagicLinkSend:WindowSeconds", 60));
                return RateLimitPartition.Get(partitionKey, key =>
                    CadenceRateLimiterFactory.FixedWindow(store, "mlsend-ip", key, permitLimit, window, failOpen: true));
            });

            options.AddPolicy(AuthEndpoints.MagicLinkVerifyRateLimitPolicy, context =>
            {
                var store = context.RequestServices.GetService<IRateLimitCounterStore>();
                // Normalize the email so casing/whitespace variants (Victim@x vs victim@x)
                // share one budget instead of each getting an independent 10/min window.
                var email = context.Request.Query["email"].ToString();
                var partitionKey = string.IsNullOrWhiteSpace(email)
                    ? "anonymous"
                    : email.Trim().ToLowerInvariant();
                return RateLimitPartition.Get(partitionKey, key =>
                    CadenceRateLimiterFactory.FixedWindow(store, "mlverify-email", key, permitLimit: 10, TimeSpan.FromMinutes(1), failOpen: true));
            });

            options.AddPolicy(AuthEndpoints.LoginRateLimitPolicy, context =>
            {
                var configuration = context.RequestServices.GetRequiredService<IConfiguration>();
                var store = context.RequestServices.GetService<IRateLimitCounterStore>();
                // Proxy-resolved client IP (see UseForwardedHeaders); ingress IP in prod
                // without it. "unknown" only when no peer/XFF is present (in-proc tests).
                var partitionKey = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
                var permitLimit = configuration.GetValue("RateLimiting:Login:PermitLimit", 10);
                var window = TimeSpan.FromSeconds(configuration.GetValue("RateLimiting:Login:WindowSeconds", 60));
                return RateLimitPartition.Get(partitionKey, key =>
                    CadenceRateLimiterFactory.FixedWindow(store, "login-ip", key, permitLimit, window, failOpen: true));
            });
        });

        return builder;
    }
}

/// <summary>
/// Builds the fixed-window <see cref="RateLimiter"/> for a partition, choosing the
/// distributed Redis-backed limiter when a <see cref="IRateLimitCounterStore"/> is
/// available and the original in-process limiter otherwise.
/// </summary>
internal static class CadenceRateLimiterFactory
{
    public static RateLimiter FixedWindow(
        IRateLimitCounterStore? store,
        string policy,
        string partition,
        int permitLimit,
        TimeSpan window,
        bool failOpen)
    {
        if (store is null)
        {
            return new FixedWindowRateLimiter(new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
            });
        }

        var key = $"cadence:rl:{policy}:{partition}";
        return new RedisFixedWindowRateLimiter(store, key, permitLimit, window, failOpen);
    }
}
