using Microsoft.Extensions.Configuration;

namespace Cadence.Api;

/// <summary>
/// Cross-origin resource sharing (CORS) settings for the browser SPA. In
/// production the SPA is served from GitHub Pages
/// (<see cref="DefaultOrigin"/>) — a different origin from the deployed API — so
/// the API must opt that origin into credentialed CORS. The allowed origins are
/// configuration-driven via <c>Cors:AllowedOrigins</c> so an operator can add or
/// swap origins (custom domains, preview environments) without a code change,
/// falling back to the public Pages origin when nothing is configured.
/// </summary>
public static class CadenceCors
{
    /// <summary>Name of the named CORS policy applied in the middleware pipeline.</summary>
    public const string PolicyName = "CadenceSpa";

    /// <summary>The public GitHub Pages origin the SPA is deployed to.</summary>
    public const string DefaultOrigin = "https://ievangelist.github.io";

    /// <summary>
    /// Resolves the allowed browser origins from <c>Cors:AllowedOrigins</c>,
    /// defaulting to <see cref="DefaultOrigin"/> when the setting is absent or
    /// empty.
    /// </summary>
    public static string[] ResolveAllowedOrigins(IConfiguration configuration) =>
        configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() is { Length: > 0 } origins
            ? origins
            : [DefaultOrigin];
}
