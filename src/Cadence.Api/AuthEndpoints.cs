using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using System.Security.Claims;
using System.Threading.RateLimiting;

namespace Cadence.Api;

/// <summary>Maps the authentication and profile HTTP endpoints.</summary>
public static class AuthEndpoints
{
    /// <summary>Rate-limit policy guarding the magic-link verify endpoint.</summary>
    public const string MagicLinkVerifyRateLimitPolicy = "magic-link-verify";

    /// <summary>Rate-limit policy guarding magic-link send volume by client IP.</summary>
    public const string MagicLinkSendRateLimitPolicy = "magic-link-send";

    /// <summary>Key for the per-email magic-link send limiter enforced inside the handler.</summary>
    public const string MagicLinkSendEmailLimiterKey = "magic-link-send-email";

    /// <summary>Rate-limit policy guarding password login volume by client IP.</summary>
    public const string LoginRateLimitPolicy = "login";

    private static readonly string DummyPasswordHash =
        new PasswordHasher<ApplicationUser>().HashPassword(new ApplicationUser(), "dummy-password-for-timing-equalization");

    /// <summary>Map <c>/api/auth/*</c> (local, magic-link, and external OAuth).</summary>
    public static IEndpointRouteBuilder MapCadenceAuth(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/auth").WithTags("Auth");

        group.MapPost("/register", RegisterAsync);
        group.MapPost("/login", LoginAsync)
            .RequireRateLimiting(LoginRateLimitPolicy);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/me", MeAsync).RequireAuthorization();
        group.MapPost("/magic-link", RequestMagicLinkAsync)
            .RequireRateLimiting(MagicLinkSendRateLimitPolicy);
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
            // Duplicate-account failures are deliberately collapsed to the same
            // generic validation shape as other registration problems. Returning a
            // full always-accepted flow would hide more, but it would also break the
            // current successful-registration contract (200 + MeResponse + sign-in).
            if (AccountHelpers.IsDuplicateAccount(result))
            {
                return AccountHelpers.NeutralRegistrationProblem();
            }

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
        CadenceDbContext db,
        IPasswordHasher<ApplicationUser> hasher)
    {
        var user = await users.FindByEmailAsync(request.Email);
        if (user is null)
        {
            _ = hasher.VerifyHashedPassword(new ApplicationUser(), DummyPasswordHash, request.Password);
            return Results.Unauthorized();
        }

        // Identity lockout remains account-keyed. Making it IP+account-keyed would
        // require a custom lockout store, so an IP-scoped rate limit is placed in
        // front to keep attackers from cheaply driving repeated 5-failure lockouts;
        // magic-link sign-in remains the recovery path.
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
        IConfiguration configuration,
        [FromKeyedServices(MagicLinkSendEmailLimiterKey)] PartitionedRateLimiter<string> emailLimiter)
    {
        // A missing/blank email is treated as a no-op success: this endpoint
        // always returns 202 regardless of account existence, and there is nothing
        // to throttle or look up. Guards against an unhandled 500 (NRE) when a
        // caller posts {"email":null} or {}.
        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return Results.Accepted();
        }

        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        using var lease = await emailLimiter.AcquireAsync(normalizedEmail, 1);
        if (!lease.IsAcquired)
        {
            return Results.StatusCode(StatusCodes.Status429TooManyRequests);
        }

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

        var valid = await users.VerifyUserTokenAsync(
            user, AccountHelpers.MagicLinkProvider, AccountHelpers.MagicLinkPurpose, token);
        if (!valid)
        {
            // Deliberately do NOT call AccessFailedAsync here. The token is already
            // high-entropy and the endpoint is rate-limited, so the shared Identity
            // lockout adds no anti-guessing value — and feeding that counter from an
            // unauthenticated GET would let an attacker who only knows a victim's
            // email lock the victim out of BOTH magic-link and password sign-in
            // (denial of service). Volume is bounded by the verify rate limiter.
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        // A successful magic link is a legitimate recovery path: clear any password
        // failure count, rotate the stamp (single-use), and sign in.
        await users.ResetAccessFailedCountAsync(user);
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
