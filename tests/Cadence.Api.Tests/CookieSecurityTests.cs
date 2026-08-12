using Microsoft.AspNetCore.Http;

namespace Cadence.Api.Tests;

public class CookieSecurityTests
{
    // Issue F: outside Development/Testing the auth cookie must be marked Secure so
    // it is never emitted over a plain-HTTP hop (e.g. behind a TLS-terminating proxy).
    [Theory]
    [InlineData(false, false, CookieSecurePolicy.Always)]
    [InlineData(true, false, CookieSecurePolicy.SameAsRequest)]
    [InlineData(false, true, CookieSecurePolicy.SameAsRequest)]
    public void ResolveCookieSecurePolicy_ReturnsExpectedPolicy(
        bool isDevelopment, bool isTesting, CookieSecurePolicy expected)
    {
        var policy = CadenceIdentityExtensions.ResolveCookieSecurePolicy(isDevelopment, isTesting);

        Assert.Equal(expected, policy);
    }

    // Cross-site topology is configuration-driven. These assert the resolution that
    // maps the optional Auth:Cookie:SameSite value + environment onto the concrete
    // (SameSite, SecurePolicy) applied to both cadence.auth and cadence.external.
    [Theory]
    // Unset => today's same-origin default: Lax + the environment-derived policy.
    [InlineData(null, true, false, SameSiteMode.Lax, CookieSecurePolicy.SameAsRequest)]
    [InlineData("", true, false, SameSiteMode.Lax, CookieSecurePolicy.SameAsRequest)]
    [InlineData("   ", false, true, SameSiteMode.Lax, CookieSecurePolicy.SameAsRequest)]
    [InlineData(null, false, false, SameSiteMode.Lax, CookieSecurePolicy.Always)]
    // Explicit Lax is identical to the unset default (config override, same value).
    [InlineData("Lax", true, false, SameSiteMode.Lax, CookieSecurePolicy.SameAsRequest)]
    [InlineData("lax", false, false, SameSiteMode.Lax, CookieSecurePolicy.Always)]
    // Strict follows the same environment-derived secure policy as Lax.
    [InlineData("Strict", true, false, SameSiteMode.Strict, CookieSecurePolicy.SameAsRequest)]
    [InlineData("strict", false, false, SameSiteMode.Strict, CookieSecurePolicy.Always)]
    // CRITICAL invariant: SameSite=None forces Secure=Always in EVERY environment,
    // overriding SameAsRequest — browsers silently drop a None cookie that is not
    // Secure, which would break cross-site auth the moment it is enabled.
    [InlineData("None", true, false, SameSiteMode.None, CookieSecurePolicy.Always)]
    [InlineData("None", false, true, SameSiteMode.None, CookieSecurePolicy.Always)]
    [InlineData("None", false, false, SameSiteMode.None, CookieSecurePolicy.Always)]
    [InlineData("none", true, true, SameSiteMode.None, CookieSecurePolicy.Always)]
    [InlineData("NONE", true, false, SameSiteMode.None, CookieSecurePolicy.Always)]
    public void ResolveCookiePolicy_ResolvesSameSiteAndSecure(
        string? configuredSameSite, bool isDevelopment, bool isTesting,
        SameSiteMode expectedSameSite, CookieSecurePolicy expectedSecure)
    {
        var (sameSite, securePolicy) = CadenceIdentityExtensions.ResolveCookiePolicy(
            configuredSameSite, isDevelopment, isTesting);

        Assert.Equal(expectedSameSite, sameSite);
        Assert.Equal(expectedSecure, securePolicy);
    }

    // The None => Secure=Always invariant holds no matter the environment flags, so
    // enabling cross-site cookies can never accidentally emit a non-Secure None cookie.
    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public void ResolveCookiePolicy_None_IsAlwaysSecure(bool isDevelopment, bool isTesting)
    {
        var (sameSite, securePolicy) = CadenceIdentityExtensions.ResolveCookiePolicy(
            "None", isDevelopment, isTesting);

        Assert.Equal(SameSiteMode.None, sameSite);
        Assert.Equal(CookieSecurePolicy.Always, securePolicy);
    }

    // An unrecognized SameSite value is an operator misconfiguration and fails fast
    // rather than silently degrading to a mode the operator did not intend.
    [Theory]
    [InlineData("Cross")]
    [InlineData("true")]
    [InlineData("Lax;None")]
    public void ResolveCookiePolicy_Throws_OnUnsupportedSameSite(string configuredSameSite)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => CadenceIdentityExtensions.ResolveCookiePolicy(configuredSameSite, false, false));

        Assert.Contains(configuredSameSite, ex.Message);
    }
}
