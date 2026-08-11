using System.Threading.RateLimiting;
using Aspire.Hosting;
using Aspire.Hosting.Testing;
using Cadence.Api.RateLimiting;

namespace Cadence.Api.IntegrationTests;

// #75: proves the auth rate-limit counters are backed by the Aspire-referenced
// Redis, so a budget is GLOBAL across API replicas and survives a replica restart.
// Two RedisRateLimitCounterStore instances over the ONE app Redis model two
// replicas; disposing and reconnecting models a restart. Requires a container
// runtime (Docker), so it is tagged Integration and runs in its own CI job.
[Trait("Category", "Integration")]
public class RedisRateLimitIntegrationTests
{
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromMinutes(5);

    [Fact]
    public async Task PerEmailCap_IsGlobalAcrossReplicas_AndSurvivesRestart()
    {
        var appHost = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.Cadence_AppHost>();

        await using var app = await appHost.BuildAsync();
        await app.StartAsync();

        await app.ResourceNotifications
            .WaitForResourceHealthyAsync("redis")
            .WaitAsync(ReadyTimeout);

        var connectionString = await app.GetConnectionStringAsync("redis");
        Assert.False(string.IsNullOrWhiteSpace(connectionString));

        var key = $"cadence:rl:it:{Guid.NewGuid():N}";
        var window = TimeSpan.FromHours(1);
        const int permitLimit = 3;

        // Two independent stores = two API replicas pointed at one Redis.
        var replicaA = RedisRateLimitCounterStore.Connect(connectionString!);
        var replicaB = RedisRateLimitCounterStore.Connect(connectionString!);

        try
        {
            // The raw counter is shared: increments on either replica accumulate into
            // one value (this is what makes the budget global rather than per-replica).
            Assert.Equal(1, replicaA.Increment(key, 1, window));
            Assert.Equal(2, replicaB.Increment(key, 1, window));
            Assert.Equal(3, await replicaA.IncrementAsync(key, 1, window));

            // Model the limiter decision across replicas: with a permit limit of 3 the
            // first three acquires (any mix of replicas) succeed and the fourth — on
            // EITHER replica — is denied, because the count lives in shared Redis.
            var limiterKey = $"{key}:limiter";
            using var limiterA = new RedisFixedWindowRateLimiter(replicaA, limiterKey, permitLimit, window, failOpen: false);
            using var limiterB = new RedisFixedWindowRateLimiter(replicaB, limiterKey, permitLimit, window, failOpen: false);

            Assert.True((await limiterA.AcquireAsync(1)).IsAcquired);
            Assert.True((await limiterB.AcquireAsync(1)).IsAcquired);
            Assert.True((await limiterA.AcquireAsync(1)).IsAcquired);
            Assert.False((await limiterB.AcquireAsync(1)).IsAcquired);
            Assert.False((await limiterA.AcquireAsync(1)).IsAcquired);

            // Simulate a replica restart: drop both connections, then reconnect. The
            // counter persists in Redis, so the budget is still exhausted afterwards —
            // the limit does not reset on restart the way an in-process limiter would.
            replicaA.Dispose();
            replicaB.Dispose();

            using var restarted = RedisRateLimitCounterStore.Connect(connectionString!);
            using var limiterAfterRestart = new RedisFixedWindowRateLimiter(restarted, limiterKey, permitLimit, window, failOpen: false);
            Assert.False((await limiterAfterRestart.AcquireAsync(1)).IsAcquired);
        }
        finally
        {
            replicaA.Dispose();
            replicaB.Dispose();
        }
    }
}
