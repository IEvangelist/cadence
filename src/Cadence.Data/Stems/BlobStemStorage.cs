using System.Diagnostics.CodeAnalysis;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Cadence.Data.Stems;

/// <summary>
/// Azure Blob Storage implementation of <see cref="IStemStorage"/>. It is thin I/O
/// glue over the Aspire-provisioned <see cref="BlobServiceClient"/> (Azurite in
/// development), so it is excluded from unit-coverage and exercised end-to-end by
/// the Aspire integration tests instead — mirroring how the offline audio render
/// and startup migration are covered.
/// </summary>
[ExcludeFromCodeCoverage]
public sealed class BlobStemStorage(BlobServiceClient service, StemOptions options) : IStemStorage
{
    private readonly BlobServiceClient _service = service;
    private readonly StemOptions _options = options;

    /// <inheritdoc />
    public async Task<string> SaveMixAsync(
        string ownerId,
        string jobId,
        string contentType,
        Stream content,
        CancellationToken cancellationToken = default)
    {
        var container = await GetContainerAsync(cancellationToken);
        var name = $"{ownerId}/{jobId}/mix";
        var blob = container.GetBlobClient(name);
        await blob.UploadAsync(
            content,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
            cancellationToken);
        return name;
    }

    /// <inheritdoc />
    public async Task<string> SaveStemAsync(
        string ownerId,
        string jobId,
        StemLabel label,
        ReadOnlyMemory<byte> wav,
        CancellationToken cancellationToken = default)
    {
        var container = await GetContainerAsync(cancellationToken);
        var name = $"{ownerId}/{jobId}/{StemCatalog.Slug(label)}.wav";
        var blob = container.GetBlobClient(name);
        using var stream = new MemoryStream(wav.ToArray(), writable: false);
        await blob.UploadAsync(
            stream,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "audio/wav" } },
            cancellationToken);
        return name;
    }

    /// <inheritdoc />
    public async Task<StemBlob?> OpenReadAsync(string blobPath, CancellationToken cancellationToken = default)
    {
        var container = _service.GetBlobContainerClient(_options.ContainerName);
        var blob = container.GetBlobClient(blobPath);
        if (!await blob.ExistsAsync(cancellationToken))
        {
            return null;
        }

        var download = await blob.DownloadStreamingAsync(cancellationToken: cancellationToken);
        return new StemBlob(download.Value.Content, download.Value.Details.ContentLength);
    }

    private async Task<BlobContainerClient> GetContainerAsync(CancellationToken cancellationToken)
    {
        var container = _service.GetBlobContainerClient(_options.ContainerName);
        await container.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
        return container;
    }
}
