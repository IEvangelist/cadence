namespace Cadence.Api.Ai;

/// <summary>
/// An in-process <see cref="IAiGenerationCounter"/> used when the referenced Redis is absent
/// (single-node dev and unit tests). It reproduces the Redis counter's semantics — an atomic
/// per-user, per-UTC-day count that resets at midnight — by keying on the UTC day, so a new
/// day is a new key and therefore a fresh count. The clock is injectable so tests can prove
/// the day rollover deterministically.
/// </summary>
public sealed class InMemoryAiGenerationCounter(Func<DateTimeOffset>? now = null) : IAiGenerationCounter
{
    private readonly object _gate = new();
    private readonly Dictionary<string, int> _counts = [];
    private readonly Func<DateTimeOffset> _now = now ?? (() => DateTimeOffset.UtcNow);

    /// <inheritdoc />
    public ValueTask<int> GetTodayAsync(string userId, CancellationToken cancellationToken = default)
    {
        var key = AiGenerationWindow.Key(userId, AiGenerationWindow.TodayUtc(_now()));
        lock (_gate)
        {
            return new(_counts.TryGetValue(key, out var count) ? count : 0);
        }
    }

    /// <inheritdoc />
    public ValueTask<int> IncrementTodayAsync(string userId, CancellationToken cancellationToken = default)
    {
        var key = AiGenerationWindow.Key(userId, AiGenerationWindow.TodayUtc(_now()));
        lock (_gate)
        {
            var next = (_counts.TryGetValue(key, out var count) ? count : 0) + 1;
            _counts[key] = next;
            return new(next);
        }
    }
}
