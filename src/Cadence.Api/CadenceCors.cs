using Microsoft.Extensions.Configuration;

namespace Cadence.Api;

/// <summary>
/// Cross-origin resource sharing (CORS) settings for the browser SPA. In
/// production the SPA is served from GitHub Pages
/// (<see cref="DefaultOrigin"/>) — a different origin from the deployed API — so
/// the API must opt that origin into credentialed CORS. The allowed origins are
/// configuration-driven via <c>Cors:AllowedOrigins</c> so an operator can add or
/// swap origins (custom domains, preview environments) without a code change,
/// falling back to the public Pages origin when nothing is configured. Origins
/// are always <em>explicit</em>: credentialed CORS is never combined with a
/// wildcard, so cross-site auth cookies only flow to allow-listed sites.
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
    /// empty. Two shapes are accepted: the canonical JSON array (or indexed keys),
    /// and — for operator convenience when configuring via a single scalar
    /// environment variable (<c>Cors__AllowedOrigins=https://a,https://b</c>) — a
    /// comma- or semicolon-separated string. Either way the origins are explicit;
    /// the API never widens to a wildcard.
    /// </summary>
    public static string[] ResolveAllowedOrigins(IConfiguration configuration)
    {
        var section = configuration.GetSection("Cors:AllowedOrigins");

        // Canonical form: a JSON array (appsettings.json) or indexed keys.
        if (section.Get<string[]>() is { Length: > 0 } origins)
        {
            return origins;
        }

        // Convenience form: a single comma/semicolon-separated string, which is how
        // a scalar environment variable arrives. Keeps CORS configurable without an
        // indexed array in the environment.
        if (!string.IsNullOrWhiteSpace(section.Value))
        {
            var split = section.Value.Split(
                [',', ';'],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (split.Length > 0)
            {
                return split;
            }
        }

        return [DefaultOrigin];
    }
}
