using System.Security.Cryptography;

namespace Cadence.Data.Stems;

/// <summary>The supported ways a stem model can be resolved.</summary>
public enum StemModelLocationKind
{
    /// <summary>A plain absolute or relative local path.</summary>
    LocalPath,

    /// <summary>An absolute <c>file://</c> URI.</summary>
    FileUri,

    /// <summary>A remote model fetched over HTTPS.</summary>
    Https,
}

/// <summary>A normalized, security-classified stem model reference.</summary>
public readonly record struct StemModelLocation(
    StemModelLocationKind Kind,
    string Reference,
    Uri? ParsedUri)
{
    /// <summary>Whether the model must be fetched from a remote HTTPS endpoint.</summary>
    public bool IsRemote => Kind == StemModelLocationKind.Https;

    /// <summary>The local path represented by a local path or file URI.</summary>
    public string LocalPath => Kind switch
    {
        StemModelLocationKind.LocalPath => Reference,
        StemModelLocationKind.FileUri => ParsedUri!.LocalPath,
        _ => throw new InvalidOperationException("A remote model does not have a local source path."),
    };
}

/// <summary>
/// Pure integrity guards for the pinned separation model: enforce a secure transport
/// for remote model URIs and verify a fetched (or local) model against a pinned
/// SHA-256 digest. Kept separate from the I/O-bound <see cref="HttpStemModelProvider"/>
/// so the security-critical checks are unit-testable without a network or a real model.
/// </summary>
public static class StemModelIntegrity
{
    /// <summary>
    /// Normalize and classify a model reference once so startup validation and model
    /// loading agree on HTTPS, file URI, and local-path handling.
    /// </summary>
    public static StemModelLocation ParseModelLocation(string modelUri)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(modelUri);
        var normalized = modelUri.Trim();

        if (IsWindowsPath(normalized) || Path.IsPathRooted(normalized))
        {
            return new StemModelLocation(StemModelLocationKind.LocalPath, normalized, null);
        }

        if (Uri.TryCreate(normalized, UriKind.Absolute, out var parsed))
        {
            if (parsed.IsFile)
            {
                return new StemModelLocation(StemModelLocationKind.FileUri, normalized, parsed);
            }

            if (string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            {
                return new StemModelLocation(StemModelLocationKind.Https, normalized, parsed);
            }

            throw new InvalidOperationException(
                "Stems:ModelUri must use https for remote models; file URIs and local paths are also allowed.");
        }

        return new StemModelLocation(StemModelLocationKind.LocalPath, normalized, null);
    }

    /// <summary>
    /// Reject an insecure or unsupported remote model scheme. HTTPS, file URIs, and
    /// bare local paths are allowed.
    /// </summary>
    public static void RequireSecureModelUri(string uri) => ParseModelLocation(uri);

    /// <summary>Whether <paramref name="digest"/> is a 64-digit SHA-256 hex value.</summary>
    public static bool IsValidSha256(string digest)
    {
        if (string.IsNullOrWhiteSpace(digest))
        {
            return false;
        }

        var normalized = digest.Trim();
        if (normalized.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized["sha256:".Length..];
        }

        return normalized.Length == 64 && normalized.All(Uri.IsHexDigit);
    }

    /// <summary>Lowercase hex SHA-256 of <paramref name="bytes"/>.</summary>
    public static string ComputeSha256Hex(ReadOnlySpan<byte> bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    /// <summary>Lowercase hex SHA-256 of the contents of <paramref name="stream"/>.</summary>
    public static async Task<string> ComputeSha256HexAsync(Stream stream, CancellationToken cancellationToken = default)
    {
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Verify <paramref name="actualHex"/> matches the pinned <paramref name="expectedHex"/>,
    /// ignoring case, surrounding whitespace, and an optional <c>sha256:</c> prefix.
    /// </summary>
    /// <exception cref="InvalidOperationException">The digests differ.</exception>
    public static void VerifyChecksum(string expectedHex, string actualHex)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedHex);
        ArgumentException.ThrowIfNullOrWhiteSpace(actualHex);

        var expected = expectedHex.Trim().Replace("sha256:", string.Empty, StringComparison.OrdinalIgnoreCase);
        var actual = actualHex.Trim();
        if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Model checksum mismatch: expected {expected}, computed {actual}. Refusing to use the model.");
        }
    }

    private static bool IsWindowsPath(string uri) =>
        uri.Length >= 3 &&
        char.IsLetter(uri[0]) &&
        uri[1] == ':' &&
        (uri[2] == '\\' || uri[2] == '/');
}
