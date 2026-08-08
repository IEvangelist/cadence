using System.Security.Claims;
using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Cadence.Api;

/// <summary>
/// Adds the caller's subscription tier (and display name) to the generated
/// principal so the entitlement seam and the SPA can read them from claims
/// without an extra round-trip.
/// </summary>
public sealed class TierClaimsPrincipalFactory(
    UserManager<ApplicationUser> userManager,
    IOptions<IdentityOptions> optionsAccessor,
    CadenceDbContext db)
    : UserClaimsPrincipalFactory<ApplicationUser>(userManager, optionsAccessor)
{
    /// <inheritdoc />
    protected override async Task<ClaimsIdentity> GenerateClaimsAsync(ApplicationUser user)
    {
        var identity = await base.GenerateClaimsAsync(user);

        var tier = await db.Profiles
            .AsNoTracking()
            .Where(p => p.UserId == user.Id)
            .Select(p => (SubscriptionTier?)p.Tier)
            .FirstOrDefaultAsync() ?? SubscriptionTier.Free;

        identity.AddClaim(new Claim(IEntitlementService.TierClaimType, tier.ToString()));

        if (!string.IsNullOrEmpty(user.DisplayName))
        {
            identity.AddClaim(new Claim("cadence:displayName", user.DisplayName));
        }

        return identity;
    }
}
