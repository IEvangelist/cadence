using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Cadence.Api;

/// <summary>
/// Wires ASP.NET Core Identity, cookie authentication (hardened), the external
/// OAuth providers that are configured, the magic-link seam, the tier claims
/// factory, and the entitlement seam.
/// </summary>
public static class CadenceIdentityExtensions
{
    private static readonly string[] KnownExternalProviders =
        ["GitHub", "Google", "Microsoft", MockExternalDefaults.Scheme];

    /// <summary>The external provider names Cadence recognizes (for the SPA).</summary>
    public static IReadOnlyList<string> ExternalProviderNames => KnownExternalProviders;

    /// <summary>Register Identity, cookie auth, external providers, and related seams.</summary>
    public static IHostApplicationBuilder AddCadenceIdentity(this IHostApplicationBuilder builder)
    {
        var services = builder.Services;

        services
            .AddIdentityCore<ApplicationUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 8;
                options.SignIn.RequireConfirmedAccount = false;
            })
            .AddRoles<IdentityRole>()
            .AddEntityFrameworkStores<CadenceDbContext>()
            .AddSignInManager()
            .AddDefaultTokenProviders()
            // Dedicated opaque, short-lived token provider for magic links (never
            // the 6-digit default email provider — see MagicLinkTokenProvider).
            .AddTokenProvider<MagicLinkTokenProvider>(AccountHelpers.MagicLinkProvider);

        // Tier/display-name claims + entitlement + magic-link seams.
        services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, TierClaimsPrincipalFactory>();
        services.AddScoped<IEntitlementService, TierEntitlementService>();
        services.AddSingleton<IMagicLinkSender, LoggingMagicLinkSender>();

        // Outside Development/Testing (both served over plain HTTP by the test host
        // and local dev), always mark the auth cookies Secure so they are never
        // emitted over an unencrypted hop (e.g. a TLS-terminating proxy).
        var securePolicy = ResolveCookieSecurePolicy(
            builder.Environment.IsDevelopment(),
            builder.Environment.IsEnvironment("Testing"));

        var auth = services
            .AddAuthentication(options =>
            {
                options.DefaultScheme = IdentityConstants.ApplicationScheme;
                options.DefaultSignInScheme = IdentityConstants.ExternalScheme;
            })
            .AddCookie(IdentityConstants.ApplicationScheme, options =>
            {
                options.Cookie.Name = "cadence.auth";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = securePolicy;
                options.SlidingExpiration = true;
                options.ExpireTimeSpan = TimeSpan.FromDays(14);
                // The API is called by a SPA: answer with status codes, never HTML redirects.
                options.Events.OnRedirectToLogin = ReturnStatus(StatusCodes.Status401Unauthorized);
                options.Events.OnRedirectToAccessDenied = ReturnStatus(StatusCodes.Status403Forbidden);
            })
            .AddCookie(IdentityConstants.ExternalScheme, options =>
            {
                options.Cookie.Name = "cadence.external";
                options.Cookie.HttpOnly = true;
                options.Cookie.SameSite = SameSiteMode.Lax;
                options.Cookie.SecurePolicy = securePolicy;
                options.ExpireTimeSpan = TimeSpan.FromMinutes(10);
            });

        AddConfiguredExternalProviders(auth, builder.Configuration);

        // A stand-in provider used only by integration/unit tests to drive the
        // external-login callback without live OAuth secrets.
        if (builder.Environment.IsEnvironment("Testing"))
        {
            auth.AddScheme<MockExternalOptions, MockExternalHandler>(
                MockExternalDefaults.Scheme, _ => { });
        }

        services.AddAuthorization();
        return builder;
    }

    private static Func<RedirectContext<CookieAuthenticationOptions>, Task> ReturnStatus(int statusCode) =>
        context =>
        {
            context.Response.StatusCode = statusCode;
            return Task.CompletedTask;
        };

    /// <summary>
    /// Decide the auth cookie <see cref="CookieSecurePolicy"/>. Development and the
    /// integration/unit test host are served over plain HTTP, so they use
    /// <see cref="CookieSecurePolicy.SameAsRequest"/>; every other environment uses
    /// <see cref="CookieSecurePolicy.Always"/> so the cookie is never sent in the clear.
    /// </summary>
    public static CookieSecurePolicy ResolveCookieSecurePolicy(bool isDevelopment, bool isTesting) =>
        isDevelopment || isTesting
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;

    private static void AddConfiguredExternalProviders(AuthenticationBuilder auth, IConfiguration configuration)
    {
        var github = configuration.GetSection("Authentication:GitHub");
        if (HasCredentials(github))
        {
            auth.AddGitHub(options =>
            {
                options.ClientId = github["ClientId"]!;
                options.ClientSecret = github["ClientSecret"]!;
                options.Scope.Add("user:email");
            });
        }

        var google = configuration.GetSection("Authentication:Google");
        if (HasCredentials(google))
        {
            auth.AddGoogle(options =>
            {
                options.ClientId = google["ClientId"]!;
                options.ClientSecret = google["ClientSecret"]!;
            });
        }

        var microsoft = configuration.GetSection("Authentication:Microsoft");
        if (HasCredentials(microsoft))
        {
            auth.AddMicrosoftAccount(options =>
            {
                options.ClientId = microsoft["ClientId"]!;
                options.ClientSecret = microsoft["ClientSecret"]!;
            });
        }
    }

    private static bool HasCredentials(IConfiguration section) =>
        !string.IsNullOrWhiteSpace(section["ClientId"]) &&
        !string.IsNullOrWhiteSpace(section["ClientSecret"]);
}
