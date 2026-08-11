namespace Cadence.Api.RateLimiting;

/// <summary>
/// A distributed fixed-window counter store shared by every API replica.
/// <para>
/// The auth rate limiters added in #66 were in-process, so under Azure Container
/// Apps autoscaling <c>N</c> replicas enforced <c>N</c> independent budgets (the
/// per-email magic-link cap of 3/hour effectively became 3×replicas/hour) and
/// reset on every scale event. Backing them with this store — one atomic counter
/// per <c>{policy}:{partition}</c> key in the referenced Redis — makes the budget
/// GLOBAL across replicas and durable across restarts.
/// </para>
/// </summary>
public interface IRateLimitCounterStore
{
    /// <summary>
    /// Atomically add <paramref name="amount"/> to the counter for
    /// <paramref name="key"/>, anchoring a fixed <paramref name="window"/> expiry on
    /// the first increment, and return the resulting count. A caller is within
    /// budget when the returned value is less than or equal to the permit limit.
    /// </summary>
    long Increment(string key, long amount, TimeSpan window);

    /// <inheritdoc cref="Increment(string, long, TimeSpan)" />
    ValueTask<long> IncrementAsync(string key, long amount, TimeSpan window, CancellationToken cancellationToken = default);
}
