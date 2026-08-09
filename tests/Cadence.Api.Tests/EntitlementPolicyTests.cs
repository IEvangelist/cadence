using Cadence.Data.Entities;
using Cadence.Data.Entitlements;

namespace Cadence.Api.Tests;

public class EntitlementPolicyTests
{
    [Fact]
    public void Free_Tier_IsGenerousButWatermarkedAndCapped()
    {
        var options = new EntitlementOptions();
        var free = options.EntitlementsFor(SubscriptionTier.Free);

        Assert.Equal(SubscriptionTier.Free, free.Tier);
        Assert.True(free.WatermarkExports);
        Assert.True(free.MaxProjects > 0, "Free tier should allow a generous, finite number of projects.");
        Assert.False(free.AdvancedFormats);
        Assert.False(free.StemSeparation);
    }

    [Fact]
    public void Pro_Tier_IsUnlockedAndWatermarkFree()
    {
        var options = new EntitlementOptions();
        var pro = options.EntitlementsFor(SubscriptionTier.Pro);

        Assert.Equal(SubscriptionTier.Pro, pro.Tier);
        Assert.False(pro.WatermarkExports);
        Assert.Equal(Entitlements.Unlimited, pro.MaxProjects);
        Assert.Equal(Entitlements.Unlimited, pro.AiGenerationsPerDay);
        Assert.True(pro.AdvancedFormats);
        Assert.True(pro.StemSeparation);
    }

    [Fact]
    public void AllowsProjectCount_RespectsCap_AndUnlimited()
    {
        var free = new EntitlementOptions().EntitlementsFor(SubscriptionTier.Free);
        Assert.True(free.AllowsProjectCount(free.MaxProjects - 1));
        Assert.False(free.AllowsProjectCount(free.MaxProjects));
        Assert.False(free.AllowsProjectCount(free.MaxProjects + 5));

        var pro = new EntitlementOptions().EntitlementsFor(SubscriptionTier.Pro);
        Assert.True(pro.AllowsProjectCount(0));
        Assert.True(pro.AllowsProjectCount(10_000));
    }

    [Fact]
    public void Options_AreBindable_ForConfigTuning()
    {
        // Limits are configuration, not code: adding/retuning a tier is a config change.
        var options = new EntitlementOptions
        {
            Free = new EntitlementPlan { MaxProjects = 2, WatermarkExports = true },
        };

        Assert.Equal(2, options.EntitlementsFor(SubscriptionTier.Free).MaxProjects);
    }

    [Theory]
    [InlineData(SubscriptionStatus.Active, SubscriptionTier.Pro)]
    [InlineData(SubscriptionStatus.Trialing, SubscriptionTier.Pro)]
    [InlineData(SubscriptionStatus.PastDue, SubscriptionTier.Free)]
    [InlineData(SubscriptionStatus.Canceled, SubscriptionTier.Free)]
    [InlineData(SubscriptionStatus.Unpaid, SubscriptionTier.Free)]
    [InlineData(SubscriptionStatus.Incomplete, SubscriptionTier.Free)]
    [InlineData(SubscriptionStatus.None, SubscriptionTier.Free)]
    public void StatusToTier_OnlyGoodStandingGrantsPaid(SubscriptionStatus status, SubscriptionTier expected)
    {
        Assert.Equal(expected, status.ToTier());
    }

    [Fact]
    public void Service_GetEntitlements_MapsTier()
    {
        var service = new TierEntitlementService();

        Assert.True(service.GetEntitlements(SubscriptionTier.Free).WatermarkExports);
        Assert.False(service.GetEntitlements(SubscriptionTier.Pro).WatermarkExports);
    }
}
