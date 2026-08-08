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
}
