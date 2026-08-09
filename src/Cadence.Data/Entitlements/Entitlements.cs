using Cadence.Data.Entities;

namespace Cadence.Data.Entitlements;

/// <summary>
/// The typed set of capabilities a subscription tier grants. Resolved from
/// <see cref="EntitlementOptions"/> so the numbers are configuration, not code —
/// adding or retuning a tier never requires touching enforcement call sites.
/// </summary>
/// <param name="Tier">The tier these entitlements belong to.</param>
/// <param name="WatermarkExports">
/// Whether audio exports carry the subtle free-tier watermark. <see langword="true"/>
/// for free, <see langword="false"/> for paid (byte-clean exports).
/// </param>
/// <param name="MaxProjects">Maximum owned projects; <c>-1</c> means unlimited.</param>
/// <param name="AiGenerationsPerDay">Daily AI generation budget; <c>-1</c> means unlimited.</param>
/// <param name="AdvancedFormats">Advanced export formats (reserved for effort #10).</param>
/// <param name="StemSeparation">Stem separation (reserved for effort #10).</param>
/// <param name="CollaborationSeats">Collaboration seats included with the tier.</param>
public sealed record Entitlements(
    SubscriptionTier Tier,
    bool WatermarkExports,
    int MaxProjects,
    int AiGenerationsPerDay,
    bool AdvancedFormats,
    bool StemSeparation,
    int CollaborationSeats)
{
    /// <summary>Sentinel used by <see cref="MaxProjects"/>/<see cref="AiGenerationsPerDay"/> for "no limit".</summary>
    public const int Unlimited = -1;

    /// <summary>True when the given project count is within the tier's project cap.</summary>
    public bool AllowsProjectCount(int currentCount) =>
        MaxProjects == Unlimited || currentCount < MaxProjects;
}
