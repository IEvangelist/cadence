using System.Security.Claims;
using Cadence.Data.Entities;

namespace Cadence.Data.Entitlements;

/// <summary>
/// Minimal entitlement seam. It surfaces the caller's <see cref="SubscriptionTier"/>
/// (carried as a claim) and answers coarse "is entitled" questions. Feature-gating
/// and billing are intentionally NOT implemented here — this only gives the billing
/// effort a stable place to plug real policy in without touching call sites.
/// </summary>
public interface IEntitlementService
{
    /// <summary>The claim type that carries the subscription tier.</summary>
    static string TierClaimType => "cadence:tier";

    /// <summary>Resolve the tier for a principal (defaults to <see cref="SubscriptionTier.Free"/>).</summary>
    SubscriptionTier GetTier(ClaimsPrincipal principal);

    /// <summary>
    /// Whether the principal is entitled to a named feature. The MVP grants every
    /// authenticated caller access; the billing effort replaces this with real policy.
    /// </summary>
    bool IsEntitled(ClaimsPrincipal principal, string feature);
}

/// <summary>
/// Default <see cref="IEntitlementService"/>: reads the tier claim and grants all
/// features to any authenticated caller (no gating yet — see effort #8).
/// </summary>
public sealed class TierEntitlementService : IEntitlementService
{
    /// <inheritdoc />
    public SubscriptionTier GetTier(ClaimsPrincipal principal)
    {
        var raw = principal.FindFirstValue(IEntitlementService.TierClaimType);
        return Enum.TryParse<SubscriptionTier>(raw, ignoreCase: true, out var tier)
            ? tier
            : SubscriptionTier.Free;
    }

    /// <inheritdoc />
    public bool IsEntitled(ClaimsPrincipal principal, string feature) =>
        principal.Identity?.IsAuthenticated == true;
}
