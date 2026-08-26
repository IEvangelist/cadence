namespace Cadence.Api;

/// <summary>Reads an untrusted stream while enforcing a hard byte limit.</summary>
internal static class CappedStreamReader
{
    /// <summary>Returns the bytes read, or <see langword="null"/> when the cap is exceeded.</summary>
    internal static async Task<byte[]?> ReadAsync(
        Stream source,
        long cap,
        CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(cap);

        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await source.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (read > cap - buffer.Length)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
