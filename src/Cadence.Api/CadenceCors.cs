using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Http;

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

    /// <summary>
    /// Validate the browser-controlled Origin on a WebSocket upgrade. CORS does not
    /// govern WebSockets, so this explicit check prevents cross-site WebSocket
    /// hijacking when the authentication cookie uses SameSite=None.
    /// </summary>
    public static bool IsAllowedWebSocketOrigin(
        HttpRequest request,
        IConfiguration configuration,
        bool allowLoopback = false)
    {
        var origin = request.Headers.Origin.ToString();
        if (!TryNormalizeOrigin(origin, out var normalized))
        {
            return false;
        }

        if (allowLoopback && new Uri(normalized).IsLoopback)
        {
            return true;
        }

        var sameOrigin = $"{request.Scheme}://{request.Host}";
        if (string.Equals(normalized, sameOrigin, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return ResolveAllowedOrigins(configuration)
            .Select(candidate => TryNormalizeOrigin(candidate, out var value) ? value : null)
            .Any(candidate => string.Equals(candidate, normalized, StringComparison.OrdinalIgnoreCase));
    }

    private static bool TryNormalizeOrigin(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            uri.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment))
        {
            return false;
        }

        normalized = uri.GetLeftPart(UriPartial.Authority);
        return true;
    }
}
