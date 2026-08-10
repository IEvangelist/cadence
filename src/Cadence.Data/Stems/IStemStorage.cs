namespace Cadence.Data.Stems;

/// <summary>An opened stem/mix blob: its content stream and byte length.</summary>
/// <param name="Content">The readable content stream (caller disposes).</param>
/// <param name="Length">The blob's length in bytes.</param>
public sealed record StemBlob(Stream Content, long Length);

/// <summary>
/// Storage seam for mix and stem audio blobs. Backed by Azure Blob Storage in
/// production (<c>BlobStemStorage</c>) and by an in-memory fake in unit tests, so
/// the pipeline and endpoints never take a hard dependency on the cloud client.
/// Blob paths are opaque server-side identifiers — never surfaced to or accepted
/// from clients — and authorization is always enforced from the database, not the
/// path.
/// </summary>
public interface IStemStorage
{
    /// <summary>Store an uploaded mix and return its opaque blob path.</summary>
    Task<string> SaveMixAsync(
        string ownerId,
        string jobId,
        string contentType,
        Stream content,
        CancellationToken cancellationToken = default);

    /// <summary>Store one separated stem (16-bit PCM WAV) and return its blob path.</summary>
    Task<string> SaveStemAsync(
        string ownerId,
        string jobId,
        StemLabel label,
        ReadOnlyMemory<byte> wav,
        CancellationToken cancellationToken = default);

    /// <summary>Open a stored blob for reading, or <see langword="null"/> if it is gone.</summary>
    Task<StemBlob?> OpenReadAsync(string blobPath, CancellationToken cancellationToken = default);
}
