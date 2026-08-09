namespace Cadence.Data.Entities;

/// <summary>
/// A user's durable billing subscription record — the server-authoritative source
/// of truth for their tier. Owner-scoped 1:1 with <see cref="ApplicationUser"/> and
/// kept in sync from Stripe webhook events (never trusted from the client). The
/// mirrored <see cref="UserProfile.Tier"/> is what the entitlement claim reads; this
/// record carries the billing linkage and lifecycle detail behind it.
/// </summary>
public sealed class Subscription
{
    /// <summary>Primary key and foreign key to the owning user (natural 1:1).</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Stripe customer id (<c>cus_…</c>), the stable per-user billing handle.</summary>
    public string? StripeCustomerId { get; set; }

    /// <summary>Stripe subscription id (<c>sub_…</c>) of the current subscription, if any.</summary>
    public string? StripeSubscriptionId { get; set; }

    /// <summary>Current lifecycle status, mapped from Stripe subscription events.</summary>
    public SubscriptionStatus Status { get; set; } = SubscriptionStatus.None;

    /// <summary>The tier this subscription currently grants (derived from <see cref="Status"/>).</summary>
    public SubscriptionTier Tier { get; set; } = SubscriptionTier.Free;

    /// <summary>End of the current paid period (UTC), when known.</summary>
    public DateTimeOffset? CurrentPeriodEnd { get; set; }

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Last-updated timestamp (UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Navigation back to the owning user.</summary>
    public ApplicationUser? User { get; set; }
}
