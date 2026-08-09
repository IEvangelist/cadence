using System.Security.Claims;
using Cadence.Data.Entities;

namespace Cadence.Data.Entitlements;

/// <summary>
/// The entitlement seam. It surfaces the caller's <see cref="SubscriptionTier"/>
/// (carried as a claim) and resolves the typed <see cref="Entitlements"/> a tier
/// grants. Enforcement stays server-authoritative: call sites resolve the
/// authoritative tier from persistence and pass it here, using the claim only as
/// a fast hint for the client.
/// </summary>
public interface IEntitlementService
{
    /// <summary>The claim type that carries the subscription tier.</summary>
    static string TierClaimType => "cadence:tier";

    /// <summary>Resolve the tier for a principal (defaults to <see cref="SubscriptionTier.Free"/>).</summary>
    SubscriptionTier GetTier(ClaimsPrincipal principal);

    /// <summary>The typed entitlements a tier grants (config-driven).</summary>
    Entitlements GetEntitlements(SubscriptionTier tier);

    /// <summary>The typed entitlements for a principal, resolved from its tier claim.</summary>
    Entitlements GetEntitlements(ClaimsPrincipal principal);

    /// <summary>
    /// Coarse "is this authenticated caller allowed to touch a feature" check.
    /// Retained for back-compat; typed gating goes through <see cref="GetEntitlements(SubscriptionTier)"/>.
    /// </summary>
    bool IsEntitled(ClaimsPrincipal principal, string feature);
}

/// <summary>
/// Default <see cref="IEntitlementService"/>: reads the tier claim and maps tiers
/// to their configured <see cref="Entitlements"/>. Stateless and pure so it is
/// trivially unit-testable; the per-tier numbers come from <see cref="EntitlementOptions"/>.
/// </summary>
public sealed class TierEntitlementService(EntitlementOptions options) : IEntitlementService
{
    private readonly EntitlementOptions _options = options;

    /// <summary>Construct with the generous built-in defaults.</summary>
    public TierEntitlementService() : this(new EntitlementOptions())
    {
    }

    /// <inheritdoc />
    public SubscriptionTier GetTier(ClaimsPrincipal principal)
    {
        var raw = principal.FindFirstValue(IEntitlementService.TierClaimType);
        return Enum.TryParse<SubscriptionTier>(raw, ignoreCase: true, out var tier)
            ? tier
            : SubscriptionTier.Free;
    }

    /// <inheritdoc />
    public Entitlements GetEntitlements(SubscriptionTier tier) => _options.EntitlementsFor(tier);

    /// <inheritdoc />
    public Entitlements GetEntitlements(ClaimsPrincipal principal) => GetEntitlements(GetTier(principal));

    /// <inheritdoc />
    public bool IsEntitled(ClaimsPrincipal principal, string feature) =>
        principal.Identity?.IsAuthenticated == true;
}
