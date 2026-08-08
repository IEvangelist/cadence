using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Cadence.Api;

/// <summary>Constants for the test-only external authentication scheme.</summary>
public static class MockExternalDefaults
{
    /// <summary>Scheme name used to simulate an external OAuth provider in tests.</summary>
    public const string Scheme = "Mock";
}

/// <summary>Options for <see cref="MockExternalHandler"/>.</summary>
public sealed class MockExternalOptions : AuthenticationSchemeOptions
{
    /// <summary>Default email for the simulated external identity.</summary>
    public string Email { get; set; } = "mock.user@example.com";

    /// <summary>Default display name for the simulated external identity.</summary>
    public string DisplayName { get; set; } = "Mock User";

    /// <summary>Default stable provider key for the simulated external identity.</summary>
    public string ProviderKey { get; set; } = "mock-provider-key";
}

/// <summary>
/// A stand-in external OAuth provider used only in the Testing environment. On
/// challenge it signs a fabricated identity into the Identity external cookie and
/// redirects back to the callback — exercising the real external-login callback
/// path without any live provider or secret. The identity can be overridden per
/// request via <c>?email=</c>, <c>?key=</c>, and <c>?name=</c> query values.
/// </summary>
public sealed class MockExternalHandler(
    IOptionsMonitor<MockExternalOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<MockExternalOptions>(options, logger, encoder)
{
    /// <inheritdoc />
    protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
        Task.FromResult(AuthenticateResult.NoResult());

    /// <inheritdoc />
    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var email = Request.Query["email"].FirstOrDefault() ?? Options.Email;
        var key = Request.Query["key"].FirstOrDefault() ?? Options.ProviderKey;
        var name = Request.Query["name"].FirstOrDefault() ?? Options.DisplayName;

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, key),
            new(ClaimTypes.Email, email),
            new(ClaimTypes.Name, name),
        };

        // Simulate the OIDC email_verified claim so tests can exercise both the
        // verified and unverified external-login linking paths.
        var emailVerified = Request.Query["emailVerified"].FirstOrDefault();
        if (!string.IsNullOrEmpty(emailVerified))
        {
            claims.Add(new Claim("email_verified", emailVerified));
        }

        var identity = new ClaimsIdentity(claims, MockExternalDefaults.Scheme);
        var principal = new ClaimsPrincipal(identity);

        await Context.SignInAsync(IdentityConstants.ExternalScheme, principal, properties);
        Response.Redirect(properties.RedirectUri ?? "/");
    }
}
