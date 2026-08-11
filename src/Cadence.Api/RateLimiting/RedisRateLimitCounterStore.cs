using StackExchange.Redis;

namespace Cadence.Api.RateLimiting;

/// <summary>
/// A <see cref="IRateLimitCounterStore"/> backed by the Aspire-referenced Redis.
/// </summary>
public sealed class RedisRateLimitCounterStore : IRateLimitCounterStore, IDisposable
{
    // Atomic fixed-window increment. INCRBY returns the post-increment count; only
    // when that count equals the amount just added (i.e. this call created a fresh
    // key) do we stamp the window TTL. That anchors the window at the first request
    // and guarantees every key eventually expires, so counters self-reset and never
    // leak. Running it as a single server-side script keeps the read-modify-write
    // atomic across all replicas hitting the same key concurrently.
    private const string IncrementScript =
        """
        local count = redis.call('INCRBY', KEYS[1], ARGV[1])
        if count == tonumber(ARGV[1]) then
            redis.call('PEXPIRE', KEYS[1], ARGV[2])
        end
        return count
        """;

    private readonly IConnectionMultiplexer _redis;
    private readonly bool _ownsConnection;

    /// <summary>
    /// Creates a store over a DI-managed <see cref="IConnectionMultiplexer"/>
    /// (registered by the Aspire <c>AddRedisClient("redis")</c> integration). The
    /// connection lifetime is owned by the container, not this instance.
    /// </summary>
    public RedisRateLimitCounterStore(IConnectionMultiplexer redis)
        : this(redis, ownsConnection: false)
    {
    }

    private RedisRateLimitCounterStore(IConnectionMultiplexer redis, bool ownsConnection)
    {
        _redis = redis;
        _ownsConnection = ownsConnection;
    }

    /// <summary>
    /// Connects a standalone store to <paramref name="connectionString"/>, owning
    /// the underlying connection. Intended for integration tests that need to model
    /// two independent replicas pointed at one real Redis without taking a direct
    /// StackExchange.Redis dependency of their own.
    /// </summary>
    public static RedisRateLimitCounterStore Connect(string connectionString)
    {
        var options = ConfigurationOptions.Parse(connectionString);
        options.AbortOnConnectFail = false;
        return new RedisRateLimitCounterStore(ConnectionMultiplexer.Connect(options), ownsConnection: true);
    }

    /// <inheritdoc />
    public long Increment(string key, long amount, TimeSpan window)
    {
        var result = _redis.GetDatabase().ScriptEvaluate(
            IncrementScript,
            [key],
            [amount, (long)window.TotalMilliseconds]);
        return (long)result;
    }

    /// <inheritdoc />
    public async ValueTask<long> IncrementAsync(string key, long amount, TimeSpan window, CancellationToken cancellationToken = default)
    {
        var result = await _redis.GetDatabase()
            .ScriptEvaluateAsync(
                IncrementScript,
                [key],
                [amount, (long)window.TotalMilliseconds])
            .WaitAsync(cancellationToken)
            .ConfigureAwait(false);
        return (long)result;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_ownsConnection)
        {
            _redis.Dispose();
        }
    }
}
