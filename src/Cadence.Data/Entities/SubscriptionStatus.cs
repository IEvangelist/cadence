namespace Cadence.Data.Entities;

/// <summary>
/// Lifecycle status of a user's billing subscription, mirroring the Stripe
/// subscription states Cadence reacts to. Only good-standing statuses grant a
/// paid tier — see <see cref="SubscriptionStatusExtensions.ToTier"/>.
/// </summary>
public enum SubscriptionStatus
{
    /// <summary>No subscription on record (never subscribed, or fully cleared).</summary>
    None = 0,

    /// <summary>Trial period — treated as paid access.</summary>
    Trialing = 1,

    /// <summary>Active, paid, in good standing.</summary>
    Active = 2,

    /// <summary>Payment failed and is being retried — no paid access until resolved.</summary>
    PastDue = 3,

    /// <summary>Canceled (or ended) — reverts to the free tier.</summary>
    Canceled = 4,

    /// <summary>Unpaid after retries exhausted — no paid access.</summary>
    Unpaid = 5,

    /// <summary>Initial payment incomplete — no paid access yet.</summary>
    Incomplete = 6,
}

/// <summary>Maps a <see cref="SubscriptionStatus"/> to the tier it grants.</summary>
public static class SubscriptionStatusExtensions
{
    /// <summary>
    /// Resolve the entitled <see cref="SubscriptionTier"/> for a status. Only
    /// good-standing paid states (<see cref="SubscriptionStatus.Active"/>,
    /// <see cref="SubscriptionStatus.Trialing"/>) grant <see cref="SubscriptionTier.Pro"/>;
    /// every other state (including past-due/unpaid/canceled) falls back to
    /// <see cref="SubscriptionTier.Free"/> so access is never granted without a
    /// current, paid-up subscription.
    /// </summary>
    public static SubscriptionTier ToTier(this SubscriptionStatus status) =>
        status is SubscriptionStatus.Active or SubscriptionStatus.Trialing
            ? SubscriptionTier.Pro
            : SubscriptionTier.Free;
}
