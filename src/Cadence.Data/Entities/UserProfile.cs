namespace Cadence.Data.Entities;

/// <summary>
/// Per-user profile carrying presentation details and the subscription tier that
/// drives the entitlement seam. Created alongside the account and kept 1:1 with
/// <see cref="ApplicationUser"/>.
/// </summary>
public sealed class UserProfile
{
    /// <summary>Primary key (matches the owning user's id for a natural 1:1).</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Foreign key to the owning user.</summary>
    public string UserId { get; set; } = string.Empty;

    /// <summary>Display name shown across the app.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Optional short bio.</summary>
    public string? Bio { get; set; }

    /// <summary>Optional avatar URL.</summary>
    public string? AvatarUrl { get; set; }

    /// <summary>
    /// Subscription tier (defaults to <see cref="SubscriptionTier.Free"/>). Surfaced
    /// as a claim and read by the entitlement seam; billing wires the transitions.
    /// </summary>
    public SubscriptionTier Tier { get; set; } = SubscriptionTier.Free;

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Last-updated timestamp (UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Navigation back to the owning user.</summary>
    public ApplicationUser? User { get; set; }
}
