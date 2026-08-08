using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using System.Security.Claims;

namespace Cadence.Api;

/// <summary>Maps the authentication and profile HTTP endpoints.</summary>
public static class AuthEndpoints
{
    /// <summary>Rate-limit policy guarding the magic-link verify endpoint.</summary>
    public const string MagicLinkVerifyRateLimitPolicy = "magic-link-verify";

    /// <summary>Map <c>/api/auth/*</c> (local, magic-link, and external OAuth).</summary>
    public static IEndpointRouteBuilder MapCadenceAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", RegisterAsync);
        group.MapPost("/login", LoginAsync);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/me", MeAsync).RequireAuthorization();
        group.MapPost("/magic-link", RequestMagicLinkAsync);
        group.MapGet("/magic-link/verify", VerifyMagicLinkAsync)
            .RequireRateLimiting(MagicLinkVerifyRateLimitPolicy);
        group.MapGet("/external/{provider}", ChallengeExternalAsync);
        group.MapGet("/external/callback", ExternalCallbackAsync);
        group.MapGet("/providers", ListProviders);

        return app;
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signIn,
        CadenceDbContext db)
    {
        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? AccountHelpers.DeriveDisplayName(request.Email)
                : request.DisplayName!,
        };

        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            return Results.ValidationProblem(AccountHelpers.ToValidationErrors(result));
        }

        await AccountHelpers.EnsureProfileAsync(db, user);
        await signIn.SignInAsync(user, isPersistent: true);
        return Results.Ok(await AccountHelpers.BuildMeAsync(db, user));
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signIn,
        CadenceDbContext db)
    {
        var user = await users.FindByEmailAsync(request.Email);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var result = await signIn.PasswordSignInAsync(user, request.Password, isPersistent: true, lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            return Results.Unauthorized();
        }

        return Results.Ok(await AccountHelpers.BuildMeAsync(db, user));
    }

    private static async Task<IResult> LogoutAsync(SignInManager<ApplicationUser> signIn)
    {
        await signIn.SignOutAsync();
        return Results.Ok();
    }

    private static async Task<IResult> MeAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var user = await users.GetUserAsync(principal);
        return user is null
            ? Results.Unauthorized()
            : Results.Ok(await AccountHelpers.BuildMeAsync(db, user));
    }

    private static async Task<IResult> RequestMagicLinkAsync(
        MagicLinkRequest request,
        UserManager<ApplicationUser> users,
        IMagicLinkSender sender,
        IConfiguration configuration)
    {
        // Only send a link to an address that already has an account. We must NOT
        // create accounts here: an unauthenticated caller could otherwise mass-
        // create accounts for arbitrary/victim emails (resource exhaustion, email
        // squatting) and set up an account for a later external-login hijack.
        var user = await users.FindByEmailAsync(request.Email);
        if (user is not null)
        {
            var token = await users.GenerateUserTokenAsync(
                user, AccountHelpers.MagicLinkProvider, AccountHelpers.MagicLinkPurpose);

            var link = $"{AccountHelpers.WebBaseUrl(configuration)}/api/auth/magic-link/verify" +
                       $"?email={Uri.EscapeDataString(request.Email)}&token={Uri.EscapeDataString(token)}";

            await sender.SendMagicLinkAsync(request.Email, link, token);
        }

        // Always 202 regardless of whether the account existed (no enumeration).
        return Results.Accepted();
    }

    private static async Task<IResult> VerifyMagicLinkAsync(
        string email,
        string token,
        UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signIn,
        IConfiguration configuration)
    {
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        // Defense in depth on top of the opaque token + endpoint rate limit: lock
        // the account after repeated bad tokens so the (already infeasible) guessing
        // window can't be widened by volume.
        if (await users.IsLockedOutAsync(user))
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        var valid = await users.VerifyUserTokenAsync(
            user, AccountHelpers.MagicLinkProvider, AccountHelpers.MagicLinkPurpose, token);
        if (!valid)
        {
            await users.AccessFailedAsync(user);
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        await users.ResetAccessFailedCountAsync(user);
        // Single-use: rotating the stamp invalidates the just-used token.
        await users.UpdateSecurityStampAsync(user);
        await signIn.SignInAsync(user, isPersistent: true);
        return Results.Redirect(AccountHelpers.SuccessUrl(configuration));
    }

    private static async Task<IResult> ChallengeExternalAsync(
        string provider,
        SignInManager<ApplicationUser> signIn,
        IAuthenticationSchemeProvider schemes)
    {
        var scheme = await schemes.GetSchemeAsync(provider);
        if (scheme is null)
        {
            return Results.NotFound(new { error = $"Unknown provider '{provider}'." });
        }

        var properties = signIn.ConfigureExternalAuthenticationProperties(
            provider, "/api/auth/external/callback");
        return Results.Challenge(properties, [provider]);
    }

    private static async Task<IResult> ExternalCallbackAsync(
        SignInManager<ApplicationUser> signIn,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IConfiguration configuration)
    {
        var info = await signIn.GetExternalLoginInfoAsync();
        if (info is null)
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        // Returning user: this external login is already linked to an account.
        var signInResult = await signIn.ExternalLoginSignInAsync(
            info.LoginProvider, info.ProviderKey, isPersistent: true, bypassTwoFactor: true);
        if (signInResult.Succeeded)
        {
            return Results.Redirect(AccountHelpers.SuccessUrl(configuration));
        }

        var providerEmailVerified = ExternalEmailIsVerified(info.Principal);
        var email = info.Principal.FindFirstValue(ClaimTypes.Email)
            ?? $"{info.ProviderKey}@{info.LoginProvider}.external.local";

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            // First time we've seen this address: create an account bound to this
            // external identity. Confirm the email only when the provider vouched
            // for it, so an unverified provider email can't later be auto-linked.
            user = new ApplicationUser
            {
                UserName = email,
                Email = email,
                EmailConfirmed = providerEmailVerified,
                DisplayName = info.Principal.FindFirstValue(ClaimTypes.Name)
                    ?? AccountHelpers.DeriveDisplayName(email),
            };
            var create = await users.CreateAsync(user);
            if (!create.Succeeded)
            {
                return Results.Redirect(AccountHelpers.FailureUrl(configuration));
            }

            await AccountHelpers.EnsureProfileAsync(db, user);

            var linkNew = await users.AddLoginAsync(user, info);
            if (!linkNew.Succeeded)
            {
                return Results.Redirect(AccountHelpers.FailureUrl(configuration));
            }

            await signIn.SignInAsync(user, isPersistent: true);
            return Results.Redirect(AccountHelpers.SuccessUrl(configuration));
        }

        // A local account with this email exists but this provider login is NOT yet
        // linked to it. Only auto-link when BOTH the provider asserts the email is
        // verified AND the local account's own email is confirmed. Otherwise an
        // attacker who pre-registered the address (or a spoofed provider email)
        // could hijack the sign-in — so require an explicit linking step instead.
        if (!providerEmailVerified || !user.EmailConfirmed)
        {
            return Results.Redirect(AccountHelpers.LinkRequiredUrl(configuration));
        }

        var link = await users.AddLoginAsync(user, info);
        if (!link.Succeeded)
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        await signIn.SignInAsync(user, isPersistent: true);
        return Results.Redirect(AccountHelpers.SuccessUrl(configuration));
    }

    /// <summary>
    /// True when the external principal asserts a verified email (the standard
    /// OIDC <c>email_verified</c> claim from Google/Microsoft). Absent or false is
    /// treated as unverified.
    /// </summary>
    private static bool ExternalEmailIsVerified(ClaimsPrincipal principal) =>
        string.Equals(principal.FindFirstValue("email_verified"), "true", StringComparison.OrdinalIgnoreCase);

    private static async Task<IResult> ListProviders(IAuthenticationSchemeProvider schemes)
    {
        var all = await schemes.GetAllSchemesAsync();
        var providers = all
            .Select(s => s.Name)
            .Where(name => CadenceIdentityExtensions.ExternalProviderNames.Contains(name))
            .ToList();
        return Results.Ok(new ProvidersResponse(providers));
    }
}
