using Cadence.Data.Entities;

namespace Cadence.Data.Entitlements;

/// <summary>
/// Configuration for the per-tier entitlement catalog. Bound from the
/// <c>Billing:Entitlements</c> configuration section so limits are tunable
/// without code changes; the defaults below ship a deliberately generous free
/// tier and an unlocked paid tier. Adding another tier is a config + enum change,
/// never a rewrite of enforcement.
/// </summary>
public sealed class EntitlementOptions
{
    /// <summary>Configuration section these options bind from.</summary>
    public const string SectionName = "Billing:Entitlements";

    /// <summary>The generous free tier (watermarked, capped, but genuinely usable).</summary>
    public EntitlementPlan Free { get; set; } = new()
    {
        WatermarkExports = true,
        MaxProjects = 10,
        AiGenerationsPerDay = 50,
        AdvancedFormats = false,
        StemSeparation = false,
        CollaborationSeats = 1,
    };

    /// <summary>The paid tier: watermark-free, uncapped, everything unlocked.</summary>
    public EntitlementPlan Pro { get; set; } = new()
    {
        WatermarkExports = false,
        MaxProjects = Entitlements.Unlimited,
        AiGenerationsPerDay = Entitlements.Unlimited,
        AdvancedFormats = true,
        StemSeparation = true,
        CollaborationSeats = 5,
    };

    /// <summary>Resolve the plan for a tier (unknown tiers fall back to <see cref="Free"/>).</summary>
    public EntitlementPlan PlanFor(SubscriptionTier tier) => tier switch
    {
        SubscriptionTier.Pro or SubscriptionTier.Studio => Pro,
        _ => Free,
    };

    /// <summary>Materialize the typed <see cref="Entitlements"/> for a tier.</summary>
    public Entitlements EntitlementsFor(SubscriptionTier tier)
    {
        var plan = PlanFor(tier);
        return new Entitlements(
            tier,
            plan.WatermarkExports,
            plan.MaxProjects,
            plan.AiGenerationsPerDay,
            plan.AdvancedFormats,
            plan.StemSeparation,
            plan.CollaborationSeats);
    }
}

/// <summary>The tunable knobs for a single tier's entitlements.</summary>
public sealed class EntitlementPlan
{
    /// <summary>Whether exports carry the free-tier audio watermark.</summary>
    public bool WatermarkExports { get; set; }

    /// <summary>Maximum owned projects; <c>-1</c> means unlimited.</summary>
    public int MaxProjects { get; set; }

    /// <summary>Daily AI generation budget; <c>-1</c> means unlimited.</summary>
    public int AiGenerationsPerDay { get; set; }

    /// <summary>Advanced export formats (reserved for effort #10).</summary>
    public bool AdvancedFormats { get; set; }

    /// <summary>Stem separation (reserved for effort #10).</summary>
    public bool StemSeparation { get; set; }

    /// <summary>Collaboration seats included with the tier.</summary>
    public int CollaborationSeats { get; set; }
}
