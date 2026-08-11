using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

namespace Cadence.Api;

/// <summary>
/// Baseline HTTP security response headers for the internet-facing API. Now that
/// the API is exposed publicly (Aspire <c>WithExternalHttpEndpoints()</c>), every
/// response carries anti-sniffing and anti-clickjacking headers, and HSTS is
/// asserted outside Development (and only over HTTPS, never the plain-HTTP dev/test
/// hop) so browsers pin TLS for the deployed host.
/// </summary>
public static class SecurityHeadersExtensions
{
    /// <summary>
    /// Registers HSTS (outside Development) and a lightweight middleware that adds
    /// <c>X-Content-Type-Options</c>, <c>X-Frame-Options</c>, and a framing-only
    /// <c>Content-Security-Policy</c> to every response.
    /// </summary>
    public static WebApplication UseCadenceSecurityHeaders(this WebApplication app)
    {
        // HSTS is meaningless over plain HTTP (the framework skips it there) and is
        // never wanted in Development, so it is asserted only outside Development.
        // Registered after UseForwardedHeaders so the request scheme reflects the
        // ingress X-Forwarded-Proto behind the container-app ingress.
        if (!app.Environment.IsDevelopment())
        {
            app.UseHsts();
        }

        // Applies to every response — including the CORS preflight, which UseCors
        // short-circuits only after this middleware has already stamped the headers.
        // The CSP is limited to frame-ancestors so it hardens the Scalar docs page
        // (when enabled) against clickjacking without constraining the scripts and
        // styles that page legitimately loads.
        app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Content-Security-Policy"] = "frame-ancestors 'none'";
            await next();
        });

        return app;
    }
}
