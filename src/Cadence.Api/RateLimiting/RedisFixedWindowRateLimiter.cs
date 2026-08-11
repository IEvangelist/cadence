using System.Threading.RateLimiting;

namespace Cadence.Api.RateLimiting;

/// <summary>
/// A <see cref="RateLimiter"/> that enforces a fixed-window limit against a shared
/// <see cref="IRateLimitCounterStore"/> so the budget is global across replicas.
/// <para>
/// Both the synchronous and asynchronous acquire paths perform a real store
/// round-trip. StackExchange.Redis exposes a first-class synchronous API, so
/// <see cref="AttemptAcquireCore"/> makes a genuine synchronous decision rather than
/// blocking on an async call — which matters because the rate-limiting middleware
/// calls <c>AttemptAcquire</c> before falling back to <c>AcquireAsync</c>.
/// </para>
/// </summary>
public sealed class RedisFixedWindowRateLimiter : RateLimiter
{
    private readonly IRateLimitCounterStore _store;
    private readonly string _key;
    private readonly int _permitLimit;
    private readonly TimeSpan _window;
    private readonly bool _failOpen;

    public RedisFixedWindowRateLimiter(
        IRateLimitCounterStore store,
        string key,
        int permitLimit,
        TimeSpan window,
        bool failOpen)
    {
        _store = store;
        _key = key;
        _permitLimit = permitLimit;
        _window = window;
        _failOpen = failOpen;
    }

    public override TimeSpan? IdleDuration => null;

    public override RateLimiterStatistics? GetStatistics() => null;

    protected override RateLimitLease AttemptAcquireCore(int permitCount)
    {
        try
        {
            var count = _store.Increment(_key, permitCount, _window);
            return Lease(count <= _permitLimit);
        }
        catch
        {
            return DegradedLease();
        }
    }

    protected override async ValueTask<RateLimitLease> AcquireAsyncCore(int permitCount, CancellationToken cancellationToken)
    {
        try
        {
            var count = await _store.IncrementAsync(_key, permitCount, _window, cancellationToken).ConfigureAwait(false);
            return Lease(count <= _permitLimit);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return DegradedLease();
        }
    }

    private RateLimitLease Lease(bool isAcquired) =>
        new FixedWindowLease(isAcquired, isAcquired ? null : _window);

    // Redis was unreachable for this decision. The fail policy is chosen per limiter:
    //   * fail CLOSED for the per-email magic-link SEND cap — the email-bomb defense
    //     is security-sensitive, so a Redis blip must not silently lift it.
    //   * fail OPEN for the coarse per-IP abuse throttles — a Redis blip should not
    //     lock legitimate users out of sign-in (a self-inflicted auth DoS); the
    //     underlying tokens remain high-entropy regardless.
    private RateLimitLease DegradedLease() =>
        _failOpen ? new FixedWindowLease(true, null) : new FixedWindowLease(false, _window);

    protected override void Dispose(bool disposing)
    {
    }

    private sealed class FixedWindowLease(bool isAcquired, TimeSpan? retryAfter) : RateLimitLease
    {
        private static readonly string[] RetryAfterMetadata = [MetadataName.RetryAfter.Name];

        public override bool IsAcquired => isAcquired;

        public override IEnumerable<string> MetadataNames =>
            retryAfter is null ? [] : RetryAfterMetadata;

        public override bool TryGetMetadata(string metadataName, out object? metadata)
        {
            if (retryAfter is { } value && metadataName == MetadataName.RetryAfter.Name)
            {
                metadata = value;
                return true;
            }

            metadata = null;
            return false;
        }
    }
}
