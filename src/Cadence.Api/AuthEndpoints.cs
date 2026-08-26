using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Api.Collaboration;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Antiforgery;
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
        group.MapGet("/register/verify", VerifyRegistrationAsync);
        group.MapPost("/login", LoginAsync)
            .RequireRateLimiting(LoginRateLimitPolicy);
        group.MapPost("/logout", LogoutAsync).RequireAuthorization();
        group.MapGet("/me", MeAsync).RequireAuthorization();
        group.MapGet("/csrf", IssueAntiforgeryToken)
            .RequireAuthorization();
        group.MapPost("/magic-link", RequestMagicLinkAsync)
            .RequireRateLimiting(MagicLinkSendRateLimitPolicy);
        group.MapGet("/magic-link/verify", VerifyMagicLinkAsync)
            .RequireRateLimiting(MagicLinkVerifyRateLimitPolicy);
        group.MapGet("/external/{provider}", ChallengeExternalAsync);
        group.MapGet("/external/callback", ExternalCallbackAsync);
        group.MapGet("/providers", ListProviders);

        return app;
    }

    private static IResult IssueAntiforgeryToken(HttpContext context, IAntiforgery antiforgery)
    {
        var tokens = antiforgery.GetAndStoreTokens(context);
        context.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new AntiforgeryTokenResponse(tokens.RequestToken!));
    }

    private static async Task<IResult> RegisterAsync(
        RegisterRequest request,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IAccountEmailQueue emailQueue,
        IPasswordHasher<ApplicationUser> hasher,
        IConfiguration configuration)
    {
        // #76: registration must NOT reveal whether an email already has an account.
        // Both a brand-new and an already-registered address get the IDENTICAL
        // 202 Accepted (no body, no auth cookie); sign-in is decoupled and only
        // happens once the emailed verification link is followed. Every early return
        // below is existence-independent so new and existing addresses stay
        // byte-for-byte indistinguishable in status and body.
        if (string.IsNullOrWhiteSpace(request.Email))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["email"] = ["An email address is required."],
            });
        }

        // Validate password strength against a transient user, so a weak password is
        // rejected the SAME way (400) for a new and an existing address — the check
        // never touches the database and therefore can't leak existence.
        var probe = new ApplicationUser { UserName = request.Email, Email = request.Email };
        foreach (var validator in users.PasswordValidators)
        {
            var check = await validator.ValidateAsync(users, probe, request.Password);
            if (!check.Succeeded)
            {
                return Results.ValidationProblem(AccountHelpers.ToValidationErrors(check));
            }
        }

        var existing = await users.FindByEmailAsync(request.Email);
        if (existing is not null)
        {
            // Known address: never disclose it. Spend the same password-hashing cost
            // the new-account path pays (timing parity), enqueue a neutral notice so
            // the real owner learns of the attempt out-of-band, and return the same
            // 202 with no cookie.
            _ = hasher.HashPassword(probe, request.Password);
            emailQueue.Enqueue((serviceProvider, cancellationToken) =>
                serviceProvider.GetRequiredService<IAccountEmailSender>()
                    .SendAlreadyRegisteredAsync(request.Email, cancellationToken));
            return Results.Accepted();
        }

        var user = new ApplicationUser
        {
            UserName = request.Email,
            Email = request.Email,
            // The account starts unconfirmed and is activated by the verification
            // link, so the register response can stay neutral (no immediate sign-in).
            EmailConfirmed = false,
            DisplayName = string.IsNullOrWhiteSpace(request.DisplayName)
                ? AccountHelpers.DeriveDisplayName(request.Email)
                : request.DisplayName!,
        };

        var result = await users.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            // A duplicate at this point means we lost a create race with a concurrent
            // registration: fold it into the existing-address behavior so the two
            // remain indistinguishable rather than surfacing a create error.
            if (AccountHelpers.IsDuplicateAccount(result))
            {
                emailQueue.Enqueue((serviceProvider, cancellationToken) =>
                    serviceProvider.GetRequiredService<IAccountEmailSender>()
                        .SendAlreadyRegisteredAsync(request.Email, cancellationToken));
                return Results.Accepted();
            }

            return Results.ValidationProblem(AccountHelpers.ToValidationErrors(result));
        }

        await AccountHelpers.EnsureProfileAsync(db, user);

        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        var link = $"{AccountHelpers.WebBaseUrl(configuration)}/api/auth/register/verify" +
                   $"?email={Uri.EscapeDataString(request.Email)}&token={Uri.EscapeDataString(token)}";
        emailQueue.Enqueue((serviceProvider, cancellationToken) =>
            serviceProvider.GetRequiredService<IAccountEmailSender>()
                .SendRegistrationVerificationAsync(request.Email, link, token, cancellationToken));

        return Results.Accepted();
    }

    private static async Task<IResult> VerifyRegistrationAsync(
        string email,
        string token,
        UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signIn,
        CadenceDbContext db,
        IConfiguration configuration)
    {
        // Activation step for the async register flow. Mirrors the magic-link verify
        // pattern: an unknown email or an invalid token redirects to the same neutral
        // error page (no enumeration), a valid token confirms the email and signs in.
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        var result = await users.ConfirmEmailAsync(user, token);
        if (!result.Succeeded)
        {
            return Results.Redirect(AccountHelpers.FailureUrl(configuration));
        }

        await AccountHelpers.EnsureProfileAsync(db, user);
        await signIn.SignInAsync(user, isPersistent: true);
        return Results.Redirect(AccountHelpers.SuccessUrl(configuration));
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

    private static async Task<IResult> LogoutAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        SignInManager<ApplicationUser> signIn,
        CollabHub collab)
    {
        var callerId = users.GetUserId(principal);
        if (!string.IsNullOrEmpty(callerId))
        {
            await collab.RevokeUserAsync(callerId);
        }
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
        IConfiguration configuration,
        IAccountEmailQueue emailQueue,
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

        // #77: close the send timing side-channel. The request path now performs the
        // SAME work for every address — normalize, acquire the limiter, enqueue one
        // job, return 202 — and the account lookup + token generation + network send
        // all run later on the background dispatcher. Because the existence-dependent
        // work is off the hot path, its duration can no longer be observed to tell a
        // known address from an unknown one. An unknown address still sends nothing:
        // the job simply finds no user and returns.
        var email = request.Email;
        var baseUrl = AccountHelpers.WebBaseUrl(configuration);
        emailQueue.Enqueue(async (serviceProvider, cancellationToken) =>
        {
            var users = serviceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = await users.FindByEmailAsync(email);
            if (user is null)
            {
                // Only send a link to an address that already has an account. We must
                // NOT create accounts here: an unauthenticated caller could otherwise
                // mass-create accounts for arbitrary/victim emails (resource
                // exhaustion, email squatting) and set up a later external-login hijack.
                return;
            }

            var token = await users.GenerateUserTokenAsync(
                user, AccountHelpers.MagicLinkProvider, AccountHelpers.MagicLinkPurpose);

            var link = $"{baseUrl}/api/auth/magic-link/verify" +
                       $"?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token)}";

            var sender = serviceProvider.GetRequiredService<IAccountEmailSender>();
            await sender.SendMagicLinkAsync(email, link, token, cancellationToken);
        });

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
