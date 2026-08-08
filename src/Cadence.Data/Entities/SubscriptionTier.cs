namespace Cadence.Data.Entities;

/// <summary>
/// Subscription tier that gates entitlements. The claim/entitlement model is
/// scaffolded here (default <see cref="Free"/>); billing and feature-gating are
/// intentionally deferred to a later effort.
/// </summary>
public enum SubscriptionTier
{
    /// <summary>Default tier for every new account.</summary>
    Free = 0,

    /// <summary>Paid individual tier (reserved for the billing effort).</summary>
    Pro = 1,

    /// <summary>Paid team/studio tier (reserved for the billing effort).</summary>
    Studio = 2,
}
