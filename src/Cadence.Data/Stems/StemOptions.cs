namespace Cadence.Data.Stems;

/// <summary>
/// Tunable knobs for stem separation, bound from the <c>Stems</c> configuration
/// section. Defaults are sensible for a local run; nothing here is a secret.
/// </summary>
public sealed class StemOptions
{
    /// <summary>Configuration section these options bind from.</summary>
    public const string SectionName = "Stems";

    /// <summary>Maximum accepted upload size in bytes (default 50 MB).</summary>
    public long MaxUploadBytes { get; set; } = 50L * 1024 * 1024;

    /// <summary>Maximum accepted mix duration in seconds (default 10 minutes).</summary>
    public int MaxDurationSeconds { get; set; } = 600;

    /// <summary>Accepted upload content types (the leading media type is matched).</summary>
    public string[] AllowedContentTypes { get; set; } =
    [
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/vnd.wave",
        "audio/mpeg",
        "audio/mp3",
        "audio/flac",
        "audio/x-flac",
        "audio/ogg",
        "audio/mp4",
        "audio/aac",
    ];

    /// <summary>Blob container that holds mixes and stems.</summary>
    public string ContainerName { get; set; } = "stems";

    /// <summary>
    /// Optional pinned separation model reference (e.g. a Blob or HTTPS URI to a
    /// Demucs ONNX export). When set, the worker uses the ONNX engine; when unset
    /// it falls back to the deterministic <see cref="BandSplitStemSeparator"/>.
    /// The model itself is fetched and cached at runtime and never committed.
    /// </summary>
    public string? ModelUri { get; set; }

    /// <summary>Whether <paramref name="contentType"/>'s media type is allowed.</summary>
    public bool IsContentTypeAllowed(string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType))
        {
            return false;
        }

        var mediaType = contentType.Split(';', 2)[0].Trim();
        return AllowedContentTypes.Any(a => string.Equals(a, mediaType, StringComparison.OrdinalIgnoreCase));
    }
}
