using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace Cadence.Api;

/// <summary>Maps the current user's profile endpoints (owner-scoped).</summary>
public static class ProfileEndpoints
{
    /// <summary>Map <c>/api/profile</c> (GET/PUT), scoped to the signed-in user.</summary>
    public static IEndpointRouteBuilder MapCadenceProfile(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/profile").WithTags("Profile").RequireAuthorization();

        group.MapGet("/", GetProfileAsync);
        group.MapPut("/", UpdateProfileAsync);

        return app;
    }

    private static async Task<IResult> GetProfileAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        await AccountHelpers.EnsureProfileAsync(db, user);
        var profile = await db.Profiles.AsNoTracking().FirstAsync(p => p.UserId == user.Id);
        return Results.Ok(ToResponse(profile));
    }

    private static async Task<IResult> UpdateProfileAsync(
        UpdateProfileRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        await AccountHelpers.EnsureProfileAsync(db, user);
        var profile = await db.Profiles.FirstAsync(p => p.UserId == user.Id);

        if (request.DisplayName is not null)
        {
            profile.DisplayName = request.DisplayName;
            user.DisplayName = request.DisplayName;
            await users.UpdateAsync(user);
        }

        if (request.Bio is not null)
        {
            profile.Bio = request.Bio;
        }

        if (request.AvatarUrl is not null)
        {
            profile.AvatarUrl = request.AvatarUrl;
        }

        profile.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return Results.Ok(ToResponse(profile));
    }

    private static ProfileResponse ToResponse(UserProfile profile) =>
        new(
            profile.Id,
            profile.DisplayName,
            profile.Bio,
            profile.AvatarUrl,
            profile.Tier.ToString(),
            profile.CreatedAt,
            profile.UpdatedAt);
}
