using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using Cadence.Data.Stems;

namespace Cadence.SeparationWorker;

/// <summary>
/// Resolves the pinned separation model to a local file path, fetching and caching
/// it on first use. The model itself is never committed to the repository — only
/// its pinned URI (and, in docs, its version, source, and license) is.
/// </summary>
public interface IStemModelProvider
{
    /// <summary>Return a local path to the model, downloading and caching if needed.</summary>
    Task<string> GetModelPathAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Fetches the ONNX model referenced by <see cref="StemOptions.ModelUri"/> and
/// caches it under the local application data directory, keyed by a hash of the
/// URI so a changed pin re-downloads. A <c>file://</c> or plain local path is used
/// in place. This is I/O glue with no unit tests (a model download would need the
/// network), so it is excluded from coverage.
/// </summary>
[ExcludeFromCodeCoverage]
public sealed class HttpStemModelProvider(
    HttpClient httpClient,
    StemOptions options,
    ILogger<HttpStemModelProvider> logger) : IStemModelProvider
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _cachedPath;

    public async Task<string> GetModelPathAsync(CancellationToken cancellationToken = default)
    {
        if (_cachedPath is not null)
        {
            return _cachedPath;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_cachedPath is not null)
            {
                return _cachedPath;
            }

            var uri = options.ModelUri
                ?? throw new InvalidOperationException("Stems:ModelUri is not configured.");

            // A local path or file URI is used directly.
            if (Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && parsed.IsFile)
            {
                _cachedPath = parsed.LocalPath;
                return _cachedPath;
            }

            if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                _cachedPath = uri;
                return _cachedPath;
            }

            var cacheDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "cadence",
                "models");
            Directory.CreateDirectory(cacheDir);

            var cachePath = Path.Combine(cacheDir, HashUri(uri) + ".onnx");
            if (!File.Exists(cachePath))
            {
                logger.LogInformation("Downloading pinned stem model from {ModelUri}.", uri);
                await DownloadAsync(uri, cachePath, cancellationToken);
            }

            _cachedPath = cachePath;
            return _cachedPath;
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task DownloadAsync(string uri, string destination, CancellationToken cancellationToken)
    {
        var tempPath = destination + ".tmp";
        using (var response = await httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
        {
            response.EnsureSuccessStatusCode();
            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
            await using var target = File.Create(tempPath);
            await source.CopyToAsync(target, cancellationToken);
        }

        // Atomic publish so a partial download is never treated as the cached model.
        File.Move(tempPath, destination, overwrite: true);
    }

    private static string HashUri(string uri)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(uri));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }
}
