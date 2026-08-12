using StackExchange.Redis;

namespace Cadence.Api.Ai;

/// <summary>
/// An <see cref="IAiGenerationCounter"/> backed by the Aspire-referenced Redis, so the #71
/// daily cap is enforced GLOBALLY across Azure Container Apps replicas. The increment runs
/// as a single server-side script (INCR + a first-write PEXPIRE anchored to the end of the
/// UTC day), keeping the read-modify-write atomic across concurrent replicas hitting the
/// same key — the same pattern as <see cref="RateLimiting.RedisRateLimitCounterStore"/>.
/// </summary>
public sealed class RedisAiGenerationCounter(IConnectionMultiplexer redis) : IAiGenerationCounter
{
    // INCR returns the post-increment count; only when it is 1 (this call created the key)
    // do we stamp the TTL, anchoring the window at the day's first generation and
    // guaranteeing the key eventually expires so the counter self-resets at midnight UTC.
    private const string IncrementScript =
        """
        local count = redis.call('INCR', KEYS[1])
        if count == 1 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
        end
        return count
        """;

    private readonly IConnectionMultiplexer _redis = redis;

    /// <inheritdoc />
    public async ValueTask<int> GetTodayAsync(string userId, CancellationToken cancellationToken = default)
    {
        var key = AiGenerationWindow.Key(userId, AiGenerationWindow.TodayUtc(DateTimeOffset.UtcNow));
        var value = await _redis.GetDatabase()
            .StringGetAsync(key)
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return value.TryParse(out long count) ? (int)count : 0;
    }

    /// <inheritdoc />
    public async ValueTask<int> IncrementTodayAsync(string userId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var key = AiGenerationWindow.Key(userId, AiGenerationWindow.TodayUtc(now));
        var ttlMs = (long)AiGenerationWindow.UntilNextUtcMidnight(now).TotalMilliseconds;
        var result = await _redis.GetDatabase()
            .ScriptEvaluateAsync(IncrementScript, [key], [ttlMs])
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return (int)(long)result;
    }
}
