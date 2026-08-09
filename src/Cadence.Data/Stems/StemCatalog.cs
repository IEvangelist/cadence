namespace Cadence.Data.Stems;

/// <summary>
/// The canonical, ordered stem catalog and the stable string slugs used in APIs,
/// blob paths, and the client. Slugs are the lower-cased enum names, so they never
/// drift from <see cref="StemLabel"/>.
/// </summary>
public static class StemCatalog
{
    /// <summary>Every stem label in catalog (display) order.</summary>
    public static IReadOnlyList<StemLabel> All { get; } =
    [
        StemLabel.Bass,
        StemLabel.Drums,
        StemLabel.Vocals,
        StemLabel.Guitar,
        StemLabel.Keys,
        StemLabel.Synth,
        StemLabel.Other,
    ];

    /// <summary>The stable, lower-cased slug for a label (e.g. <c>vocals</c>).</summary>
    public static string Slug(StemLabel label) => label.ToString().ToLowerInvariant();

    /// <summary>
    /// Parse a slug back to a <see cref="StemLabel"/> (case-insensitive). Returns
    /// <see langword="false"/> for anything not in the catalog.
    /// </summary>
    public static bool TryParse(string? slug, out StemLabel label)
    {
        // Enum.TryParse also accepts the underlying numbers ("0" -> Bass); require the
        // input to be a real catalog slug so only names like "bass"/"vocals" resolve.
        if (!string.IsNullOrWhiteSpace(slug) &&
            Enum.TryParse(slug, ignoreCase: true, out label) &&
            All.Contains(label) &&
            string.Equals(Slug(label), slug, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        label = default;
        return false;
    }
}
