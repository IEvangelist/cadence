using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Cadence.Api;

/// <summary>Shared helpers for the auth/profile/project endpoints.</summary>
internal static class AccountHelpers
{
    /// <summary>Token purpose for passwordless magic-link sign-in.</summary>
    public const string MagicLinkPurpose = "cadence-magic-link";

    /// <summary>
    /// Name of the dedicated, high-entropy data-protector token provider used for
    /// magic links. Deliberately NOT the default email provider, whose tokens are
    /// short numeric TOTP codes that are feasible to brute-force.
    /// </summary>
    public const string MagicLinkProvider = "MagicLink";

    /// <summary>Derive a friendly display name from an email local-part.</summary>
    public static string DeriveDisplayName(string email)
    {
        var at = email.IndexOf('@');
        var local = at > 0 ? email[..at] : email;
        return string.IsNullOrWhiteSpace(local) ? "Musician" : local;
    }

    /// <summary>Create the 1:1 profile for a user if it does not yet exist.</summary>
    public static async Task EnsureProfileAsync(CadenceDbContext db, ApplicationUser user, CancellationToken ct = default)
    {
        var exists = await db.Profiles.AnyAsync(p => p.UserId == user.Id, ct);
        if (exists)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        db.Profiles.Add(new UserProfile
        {
            Id = user.Id,
            UserId = user.Id,
            DisplayName = string.IsNullOrWhiteSpace(user.DisplayName)
                ? DeriveDisplayName(user.Email ?? user.UserName ?? user.Id)
                : user.DisplayName,
            Tier = SubscriptionTier.Free,
            CreatedAt = now,
            UpdatedAt = now,
        });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Build the identity summary for a signed-in user.</summary>
    public static async Task<MeResponse> BuildMeAsync(CadenceDbContext db, ApplicationUser user, CancellationToken ct = default)
    {
        var profile = await db.Profiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == user.Id, ct);
        var tier = profile?.Tier ?? SubscriptionTier.Free;
        var displayName = profile?.DisplayName ?? user.DisplayName;
        return new MeResponse(user.Id, user.Email ?? string.Empty, displayName, tier.ToString());
    }

    /// <summary>Flatten Identity errors into a validation-problem dictionary.</summary>
    public static Dictionary<string, string[]> ToValidationErrors(IdentityResult result) =>
        new()
        {
            ["identity"] = result.Errors.Select(e => e.Description).ToArray(),
        };

    /// <summary>True when Identity rejected registration because the account key already exists.</summary>
    public static bool IsDuplicateAccount(IdentityResult result) =>
        result.Errors.Any(e => e.Code is "DuplicateUserName" or "DuplicateEmail");

    /// <summary>Build a generic registration failure that does not disclose account existence.</summary>
    public static IResult NeutralRegistrationProblem() =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            ["registration"] =
            [
                "Registration could not be completed. Please check your details and try again.",
            ],
        });

    /// <summary>Base URL the SPA is served from, used for post-auth redirects.</summary>
    public static string WebBaseUrl(IConfiguration configuration) =>
        configuration["Authentication:Web:BaseUrl"]?.TrimEnd('/') ?? string.Empty;

    /// <summary>Redirect target after a successful browser-based sign-in.</summary>
    public static string SuccessUrl(IConfiguration configuration) =>
        $"{WebBaseUrl(configuration)}/?auth=success";

    /// <summary>Redirect target after a failed browser-based sign-in.</summary>
    public static string FailureUrl(IConfiguration configuration) =>
        $"{WebBaseUrl(configuration)}/?auth=error";

    /// <summary>
    /// Redirect target when an external sign-in matches an existing local account
    /// that cannot be auto-linked safely (unverified provider email or an
    /// unconfirmed local account). The user must complete an explicit,
    /// authenticated linking step instead.
    /// </summary>
    public static string LinkRequiredUrl(IConfiguration configuration) =>
        $"{WebBaseUrl(configuration)}/?auth=error&reason=link-required";
}
