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

    /// <summary>
    /// Configuration key controlling the auth cookies' <c>SameSite</c> attribute
    /// (<c>Lax</c>/<c>None</c>/<c>Strict</c>). Absent =&gt; today's same-origin
    /// default of <see cref="SameSiteMode.Lax"/>. Set to <c>None</c> to make the
    /// cookie flow on cross-site requests (the API hosted on a different site than
    /// the SPA) — a deploy-time toggle rather than a code change.
    /// </summary>
    public const string CookieSameSiteConfigKey = "Auth:Cookie:SameSite";

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

        // Tier/display-name claims + entitlement + account-email seams.
        services.AddScoped<IUserClaimsPrincipalFactory<ApplicationUser>, TierClaimsPrincipalFactory>();
        services.AddScoped<IEntitlementService, TierEntitlementService>();
        services.AddSingleton<IAccountEmailSender, LoggingAccountEmailSender>();

        // Background dispatch for account emails: the same instance is the queue
        // (injected into handlers) and the hosted consumer that drains it. Sending
        // off the request thread is what makes the magic-link/register send paths
        // constant-time with respect to account existence (#77).
        services.AddSingleton<AccountEmailDispatcher>();
        services.AddSingleton<IAccountEmailQueue>(sp => sp.GetRequiredService<AccountEmailDispatcher>());
        services.AddHostedService(sp => sp.GetRequiredService<AccountEmailDispatcher>());

        // Cookie topology is configuration-driven so cross-site hosting (the SPA on
        // a different site than the API) is a deploy-time toggle rather than a code
        // change. When unset this resolves to today's same-origin default:
        // SameSite=Lax with the environment-derived secure policy below. Outside
        // Development/Testing (both served over plain HTTP by the test host and local
        // dev) the auth cookies are always marked Secure so they are never emitted
        // over an unencrypted hop (e.g. a TLS-terminating proxy); a SameSite=None
        // cookie is additionally forced Secure in EVERY environment (browser rule).
        var (cookieSameSite, cookieSecurePolicy) = ResolveCookiePolicy(
            builder.Configuration[CookieSameSiteConfigKey],
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
                options.Cookie.SameSite = cookieSameSite;
                options.Cookie.SecurePolicy = cookieSecurePolicy;
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
                options.Cookie.SameSite = cookieSameSite;
                options.Cookie.SecurePolicy = cookieSecurePolicy;
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

    /// <summary>
    /// Resolve the auth cookies' <see cref="SameSiteMode"/> and
    /// <see cref="CookieSecurePolicy"/> from the (optional) configured SameSite value
    /// (<see cref="CookieSameSiteConfigKey"/>) and the current environment. When the
    /// value is absent the result is today's same-origin default:
    /// <see cref="SameSiteMode.Lax"/> paired with the environment-derived secure
    /// policy (see <see cref="ResolveCookieSecurePolicy"/>).
    /// <para>
    /// Hard browser rule: a <see cref="SameSiteMode.None"/> (cross-site) cookie is
    /// silently <em>dropped</em> by Chrome/Firefox/Safari unless it is also marked
    /// <c>Secure</c>. So <c>None</c> forces <see cref="CookieSecurePolicy.Always"/>
    /// in <em>every</em> environment, overriding the
    /// <see cref="CookieSecurePolicy.SameAsRequest"/> that Development/Testing would
    /// otherwise use — otherwise cross-site auth would break the moment it is enabled.
    /// </para>
    /// </summary>
    public static (SameSiteMode SameSite, CookieSecurePolicy SecurePolicy) ResolveCookiePolicy(
        string? configuredSameSite, bool isDevelopment, bool isTesting)
    {
        var sameSite = ParseSameSite(configuredSameSite);
        var securePolicy = ResolveCookieSecurePolicy(isDevelopment, isTesting);

        if (sameSite is SameSiteMode.None)
        {
            securePolicy = CookieSecurePolicy.Always;
        }

        return (sameSite, securePolicy);
    }

    /// <summary>
    /// Parse the configured SameSite value (<c>Lax</c>/<c>None</c>/<c>Strict</c>,
    /// case-insensitive), defaulting to <see cref="SameSiteMode.Lax"/> when absent.
    /// An unrecognized value is an operator misconfiguration and fails fast.
    /// </summary>
    private static SameSiteMode ParseSameSite(string? configuredSameSite) =>
        string.IsNullOrWhiteSpace(configuredSameSite)
            ? SameSiteMode.Lax
            : configuredSameSite.Trim().ToLowerInvariant() switch
            {
                "lax" => SameSiteMode.Lax,
                "none" => SameSiteMode.None,
                "strict" => SameSiteMode.Strict,
                _ => throw new InvalidOperationException(
                    $"Configuration '{CookieSameSiteConfigKey}' has unsupported value " +
                    $"'{configuredSameSite}'. Valid values are 'Lax', 'None', or 'Strict'."),
            };

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
