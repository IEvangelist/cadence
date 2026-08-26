using System.Security.Cryptography;

namespace Cadence.Data.Stems;

/// <summary>
/// Pure integrity guards for the pinned separation model: enforce a secure transport
/// for remote model URIs and verify a fetched (or local) model against a pinned
/// SHA-256 digest. Kept separate from the I/O-bound <see cref="HttpStemModelProvider"/>
/// so the security-critical checks are unit-testable without a network or a real model.
/// </summary>
public static class StemModelIntegrity
{
    /// <summary>
    /// Reject an insecure <c>http://</c> model URI: a plaintext model download is
    /// MITM-substitutable. <c>https</c>, <c>file</c>, and bare local paths are allowed
    /// (the latter two are not exposed to a network transport).
    /// </summary>
    /// <exception cref="InvalidOperationException">The URI uses the <c>http</c> scheme.</exception>
    public static void RequireSecureModelUri(string uri)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(uri);

        if (IsWindowsPath(uri) || Path.IsPathRooted(uri))
        {
            return;
        }

        if (Uri.TryCreate(uri, UriKind.Absolute, out var parsed) &&
            !parsed.IsFile &&
            !string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Stems:ModelUri must use https for remote models; file URIs and local paths are also allowed.");
        }
    }

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
