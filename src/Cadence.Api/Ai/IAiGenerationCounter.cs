namespace Cadence.Api.Ai;

/// <summary>
/// A per-user, per-day generation counter backing the #71 daily cap. It is deliberately
/// separate from the auth rate-limiter's <c>IRateLimitCounterStore</c> so enabling the AI
/// feature never changes auth throttling, but it follows the same discipline: an atomic
/// increment with a first-write-anchored expiry, Redis-backed across replicas when the
/// referenced Redis is present and an in-memory singleton otherwise (single-node dev and
/// unit tests).
/// <para>
/// "Today" is the UTC calendar day, so a user's budget resets at 00:00 UTC. Only
/// <see cref="IncrementTodayAsync"/> mutates state, and the endpoint calls it only after a
/// successful generation, so failed/unavailable/over-cap requests never consume budget.
/// </para>
/// </summary>
public interface IAiGenerationCounter
{
    /// <summary>The caller's generation count for the current UTC day (0 when none yet).</summary>
    ValueTask<int> GetTodayAsync(string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atomically add one to the caller's count for the current UTC day and return the new
    /// total, anchoring an end-of-day expiry on the first increment so the counter
    /// self-resets and never leaks.
    /// </summary>
    ValueTask<int> IncrementTodayAsync(string userId, CancellationToken cancellationToken = default);
}

/// <summary>
/// Shared day-window math for the AI daily cap: the per-user Redis key, the current UTC
/// day, and the time remaining until the next UTC midnight (the <c>Retry-After</c> hint and
/// the counter TTL).
/// </summary>
internal static class AiGenerationWindow
{
    /// <summary>The UTC calendar day for <paramref name="now"/>.</summary>
    public static DateOnly TodayUtc(DateTimeOffset now) => DateOnly.FromDateTime(now.UtcDateTime);

    /// <summary>The counter key for a user on a given UTC day, e.g. <c>cadence:ai:gen:{id}:20260812</c>.</summary>
    public static string Key(string userId, DateOnly day) => $"cadence:ai:gen:{userId}:{day:yyyyMMdd}";

    /// <summary>
    /// Time from <paramref name="now"/> to the next UTC midnight, floored at one second so a
    /// call made in the final moment of a day still yields a positive TTL / retry hint.
    /// </summary>
    public static TimeSpan UntilNextUtcMidnight(DateTimeOffset now)
    {
        var remaining = now.UtcDateTime.Date.AddDays(1) - now.UtcDateTime;
        return remaining < TimeSpan.FromSeconds(1) ? TimeSpan.FromSeconds(1) : remaining;
    }
}
