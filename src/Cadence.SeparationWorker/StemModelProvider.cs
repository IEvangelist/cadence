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
/// URI so a changed pin re-downloads. Remote pins must be <c>https</c> (an
/// <c>http</c> pin is rejected as MITM-substitutable) and, when
/// <see cref="StemOptions.ModelSha256"/> is configured, the fetched bytes are
/// verified against that digest before the model is cached or used. A <c>file://</c>
/// or plain local path is used in place (still digest-verified when pinned). This is
/// I/O glue with no unit tests (a model download would need the network) — the pure
/// checks it delegates to live in <see cref="StemModelIntegrity"/> and are unit-tested
/// — so it is excluded from coverage.
/// </summary>
[ExcludeFromCodeCoverage]
public sealed class HttpStemModelProvider : IStemModelProvider
{
    private readonly HttpClient _httpClient;
    private readonly StemOptions _options;
    private readonly ILogger<HttpStemModelProvider> _logger;
    private readonly string _cacheDirectory;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _cachedPath;

    /// <summary>Create a provider using the per-user Cadence model cache.</summary>
    public HttpStemModelProvider(
        HttpClient httpClient,
        StemOptions options,
        ILogger<HttpStemModelProvider> logger)
        : this(
            httpClient,
            options,
            logger,
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "cadence",
                "models"))
    {
    }

    internal HttpStemModelProvider(
        HttpClient httpClient,
        StemOptions options,
        ILogger<HttpStemModelProvider> logger,
        string cacheDirectory)
    {
        _httpClient = httpClient;
        _options = options;
        _logger = logger;
        _cacheDirectory = cacheDirectory;
    }

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

            var uri = _options.ModelUri
                ?? throw new InvalidOperationException("Stems:ModelUri is not configured.");

            // Reject an insecure http:// pin outright (MITM-substitutable), regardless
            // of whether a digest is configured.
            StemModelIntegrity.RequireSecureModelUri(uri);

            // A local path or file URI is used in place (still digest-verified when a
            // pin is configured, but never purged — it is the operator's own file).
            if (Uri.TryCreate(uri, UriKind.Absolute, out var parsed) && parsed.IsFile)
            {
                await VerifyIfPinnedAsync(parsed.LocalPath, purgeOnMismatch: false, cancellationToken);
                _cachedPath = parsed.LocalPath;
                return _cachedPath;
            }

            if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                await VerifyIfPinnedAsync(uri, purgeOnMismatch: false, cancellationToken);
                _cachedPath = uri;
                return _cachedPath;
            }

            Directory.CreateDirectory(_cacheDirectory);

            var cachePath = Path.Combine(_cacheDirectory, HashUri(uri) + ".onnx");
            if (!File.Exists(cachePath))
            {
                _logger.LogInformation("Downloading pinned stem model from {ModelUri}.", uri);
                await DownloadAsync(uri, cachePath, cancellationToken);
            }
            else
            {
                // Re-verify an already-cached model so a poisoned cache entry is caught
                // and immediately replaced rather than silently reused.
                try
                {
                    await VerifyIfPinnedAsync(cachePath, purgeOnMismatch: true, cancellationToken);
                }
                catch (InvalidOperationException exception)
                {
                    _logger.LogWarning(exception, "Purged poisoned cached stem model; downloading a clean copy.");
                    await DownloadAsync(uri, cachePath, cancellationToken);
                }
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
        try
        {
            using (var response = await _httpClient.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken))
            {
                response.EnsureSuccessStatusCode();
                await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
                await using var target = File.Create(tempPath);
                await source.CopyToAsync(target, cancellationToken);
            }

            // Verify integrity before the file is ever published to the cache path, so a
            // MITM-substituted or corrupted binary is never used.
            await VerifyIfPinnedAsync(tempPath, purgeOnMismatch: false, cancellationToken);

            // Atomic publish so a partial/failed download is never treated as cached.
            File.Move(tempPath, destination, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    /// <summary>
    /// Verify <paramref name="path"/> against <see cref="StemOptions.ModelSha256"/> when a
    /// digest is configured. Optionally purges the file on mismatch (for cache entries,
    /// so a later run re-fetches). When no digest is pinned, logs a warning and skips.
    /// </summary>
    private async Task VerifyIfPinnedAsync(string path, bool purgeOnMismatch, CancellationToken cancellationToken)
    {
        if (_options.ModelSha256 is not { Length: > 0 } expected)
        {
            _logger.LogWarning("Stems:ModelSha256 is not set; the stem model is not integrity-verified.");
            return;
        }

        string actual;
        await using (var stream = File.OpenRead(path))
        {
            actual = await StemModelIntegrity.ComputeSha256HexAsync(stream, cancellationToken);
        }

        try
        {
            StemModelIntegrity.VerifyChecksum(expected, actual);
        }
        catch
        {
            if (purgeOnMismatch && File.Exists(path))
            {
                File.Delete(path);
            }

            throw;
        }
    }

    private static string HashUri(string uri)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(uri));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }
}
