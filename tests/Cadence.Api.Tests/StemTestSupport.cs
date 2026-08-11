using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Stems;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Cadence.Api.Tests;

/// <summary>
/// An in-memory <see cref="IStemStorage"/> for pipeline unit tests: blobs live in a
/// dictionary keyed by the same opaque paths the real storage would mint, so tests
/// can seed a mix and assert on the stems that come out without touching Azure.
/// </summary>
internal sealed class InMemoryStemStorage : IStemStorage
{
    private readonly Dictionary<string, byte[]> _blobs = [];

    /// <summary>All stored blobs (path → bytes).</summary>
    public IReadOnlyDictionary<string, byte[]> Blobs => _blobs;

    /// <summary>Seed a mix blob directly at a known path.</summary>
    public string SeedMix(string ownerId, string jobId, byte[] bytes)
    {
        var path = $"{ownerId}/{jobId}/mix";
        _blobs[path] = bytes;
        return path;
    }

    public Task<string> SaveMixAsync(string ownerId, string jobId, string contentType, Stream content, CancellationToken cancellationToken = default)
    {
        using var ms = new MemoryStream();
        content.CopyTo(ms);
        var path = $"{ownerId}/{jobId}/mix";
        _blobs[path] = ms.ToArray();
        return Task.FromResult(path);
    }

    public Task<string> SaveStemAsync(string ownerId, string jobId, StemLabel label, ReadOnlyMemory<byte> wav, CancellationToken cancellationToken = default)
    {
        var path = $"{ownerId}/{jobId}/{StemCatalog.Slug(label)}.wav";
        _blobs[path] = wav.ToArray();
        return Task.FromResult(path);
    }

    public Task<StemBlob?> OpenReadAsync(string blobPath, CancellationToken cancellationToken = default)
    {
        if (_blobs.TryGetValue(blobPath, out var bytes))
        {
            return Task.FromResult<StemBlob?>(new StemBlob(new MemoryStream(bytes, writable: false), bytes.LongLength));
        }

        return Task.FromResult<StemBlob?>(null);
    }
}

/// <summary>An <see cref="IStemSeparator"/> that always throws, to drive the failure path.</summary>
internal sealed class ThrowingStemSeparator : IStemSeparator
{
    /// <summary>The message the thrown exception carries.</summary>
    public const string Message = "engine exploded";

    public Task<IReadOnlyList<SeparatedStem>> SeparateAsync(Stream mix, string contentType, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException(Message);
}

/// <summary>
/// Builds throwaway SQLite-backed <see cref="CadenceDbContext"/> instances over a
/// uniquely-named, shared-cache, in-memory database, so multiple contexts see the
/// same schema and rows within a single test (mirroring <see cref="CadenceApiFactory"/>)
/// without contending on one connection object.
/// </summary>
internal sealed class StemDbHarness : IDisposable
{
    private readonly string _connectionString;
    private readonly SqliteConnection _keepAlive;

    public StemDbHarness()
    {
        _connectionString = SqliteTestDatabase.NewConnectionString();
        _keepAlive = SqliteTestDatabase.OpenKeepAlive(_connectionString);
        using var ctx = CreateContext();
        ctx.Database.EnsureCreated();
    }

    /// <summary>A fresh context over the shared in-memory database.</summary>
    public CadenceDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<CadenceDbContext>().UseSqlite(_connectionString).Options);

    /// <summary>Insert an owner user so job foreign keys resolve.</summary>
    public async Task SeedOwnerAsync(string ownerId)
    {
        await using var db = CreateContext();
        db.Users.Add(new ApplicationUser { Id = ownerId, UserName = $"{ownerId}@example.com", Email = $"{ownerId}@example.com" });
        await db.SaveChangesAsync();
    }

    public void Dispose() => _keepAlive.Dispose();
}

/// <summary>Synthesizes small PCM/WAV mixes for the DSP and pipeline tests.</summary>
internal static class StemAudioFixtures
{
    /// <summary>
    /// A deterministic multi-tone stereo mix as a 16-bit PCM WAV. The tones span the
    /// band-split filter centers so every stem carries real energy.
    /// </summary>
    public static byte[] CreateMixWav(int sampleRate = 44100, int channels = 2, int frames = 4410)
    {
        var samples = new float[frames * channels];
        double[] tones = [60, 180, 500, 1200, 2500, 8000];
        for (var frame = 0; frame < frames; frame++)
        {
            var t = frame / (double)sampleRate;
            var value = 0.0;
            foreach (var f in tones)
            {
                value += Math.Sin(2 * Math.PI * f * t);
            }

            value /= tones.Length;
            for (var ch = 0; ch < channels; ch++)
            {
                samples[(frame * channels) + ch] = (float)value;
            }
        }

        return WavAudio.Encode(new PcmAudio(sampleRate, channels, samples));
    }
}
