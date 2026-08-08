using System.Security.Claims;
using Cadence.Data.Entitlements;
using Cadence.Data.Entities;

namespace Cadence.Api.Tests;

public class EntitlementServiceTests
{
    private static ClaimsPrincipal PrincipalWith(params Claim[] claims) =>
        new(new ClaimsIdentity(claims, authenticationType: "Test"));

    [Fact]
    public void GetTier_ReadsTierClaim()
    {
        var service = new TierEntitlementService();
        var principal = PrincipalWith(new Claim(IEntitlementService.TierClaimType, "Pro"));

        Assert.Equal(SubscriptionTier.Pro, service.GetTier(principal));
    }

    [Fact]
    public void GetTier_DefaultsToFree_WhenClaimMissing()
    {
        var service = new TierEntitlementService();
        var principal = PrincipalWith(new Claim(ClaimTypes.Name, "x"));

        Assert.Equal(SubscriptionTier.Free, service.GetTier(principal));
    }

    [Fact]
    public void GetTier_DefaultsToFree_WhenClaimUnparseable()
    {
        var service = new TierEntitlementService();
        var principal = PrincipalWith(new Claim(IEntitlementService.TierClaimType, "bogus"));

        Assert.Equal(SubscriptionTier.Free, service.GetTier(principal));
    }

    [Fact]
    public void IsEntitled_GrantsAny_AuthenticatedCaller()
    {
        var service = new TierEntitlementService();
        var principal = PrincipalWith(new Claim(ClaimTypes.NameIdentifier, "user-1"));

        Assert.True(service.IsEntitled(principal, "any-feature"));
    }

    [Fact]
    public void IsEntitled_DeniesAnonymousCaller()
    {
        var service = new TierEntitlementService();
        var anonymous = new ClaimsPrincipal(new ClaimsIdentity());

        Assert.False(service.IsEntitled(anonymous, "any-feature"));
    }

    [Fact]
    public void TierClaimType_IsStable()
    {
        Assert.Equal("cadence:tier", IEntitlementService.TierClaimType);
    }
}
