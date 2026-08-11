using Cadence.Api.RateLimiting;

namespace Cadence.Api.Tests;

/// <summary>
/// An in-memory <see cref="IRateLimitCounterStore"/> that reproduces the atomic
/// fixed-window semantics of the Redis store (increment + first-write-anchored
/// expiry). A single instance shared between two <see cref="CadenceApiFactory"/>
/// instances models one Redis shared by two API replicas, so a test can prove the
/// per-email cap is enforced GLOBALLY across replicas (#75) without Docker.
/// </summary>
internal sealed class InMemoryRateLimitCounterStore(Func<DateTimeOffset>? now = null) : IRateLimitCounterStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, Window> _windows = new();
    private readonly Func<DateTimeOffset> _now = now ?? (() => DateTimeOffset.UtcNow);

    public long Increment(string key, long amount, TimeSpan window)
    {
        lock (_gate)
        {
            var now = _now();
            if (!_windows.TryGetValue(key, out var entry) || entry.ExpiresAt <= now)
            {
                entry = new Window(0, now + window);
            }

            entry = entry with { Count = entry.Count + amount };
            _windows[key] = entry;
            return entry.Count;
        }
    }

    public ValueTask<long> IncrementAsync(string key, long amount, TimeSpan window, CancellationToken cancellationToken = default) =>
        new(Increment(key, amount, window));

    private readonly record struct Window(long Count, DateTimeOffset ExpiresAt);
}
