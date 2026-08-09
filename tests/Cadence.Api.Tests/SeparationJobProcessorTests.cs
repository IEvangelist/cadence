using Cadence.Data.Entities;
using Cadence.Data.Stems;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for the background separation pipeline: claiming, the happy path
/// (queued → processing → completed with persisted stems), and the failure path
/// (a mid-run error fails the job without half-persisting stems).
/// </summary>
public class SeparationJobProcessorTests
{
    private static SeparationJob NewQueuedJob(string ownerId, string jobId, string mixPath, DateTimeOffset createdAt) => new()
    {
        Id = jobId,
        OwnerId = ownerId,
        Status = JobStatus.Queued,
        OriginalFileName = "mix.wav",
        ContentType = "audio/wav",
        MixBlobPath = mixPath,
        SizeBytes = 1,
        CreatedAt = createdAt,
        UpdatedAt = createdAt,
    };

    [Fact]
    public async Task ProcessAsync_HappyPath_CompletesJobWithAllStems()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var mixPath = storage.SeedMix("owner", "job", StemAudioFixtures.CreateMixWav());

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", mixPath, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var processor = new SeparationJobProcessor(db, storage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);
            var job = await db.SeparationJobs.SingleAsync();
            await processor.ProcessAsync(job);
        }

        await using (var db = harness.CreateContext())
        {
            var job = await db.SeparationJobs.Include(j => j.Stems).SingleAsync();
            Assert.Equal(JobStatus.Completed, job.Status);
            Assert.NotNull(job.CompletedAt);
            Assert.Null(job.ErrorMessage);
            Assert.Equal(StemCatalog.All.OrderBy(l => l), job.Stems.Select(s => s.Label).OrderBy(l => l));
            Assert.All(job.Stems, s => Assert.True(s.SizeBytes > 0));
        }

        // Every stem was written to storage (mix + 7 stems).
        Assert.Equal(1 + StemCatalog.All.Count, storage.Blobs.Count);
    }

    [Fact]
    public async Task ProcessAsync_WhenSeparatorThrows_FailsJob_AndPersistsNoStems()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var mixPath = storage.SeedMix("owner", "job", StemAudioFixtures.CreateMixWav());

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", mixPath, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var processor = new SeparationJobProcessor(db, storage, new ThrowingStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);
            await processor.ProcessAsync(await db.SeparationJobs.SingleAsync());
        }

        await using (var db = harness.CreateContext())
        {
            var job = await db.SeparationJobs.Include(j => j.Stems).SingleAsync();
            Assert.Equal(JobStatus.Failed, job.Status);
            Assert.Equal(ThrowingStemSeparator.Message, job.ErrorMessage);
            Assert.Empty(job.Stems);
        }

        // Only the seeded mix remains — no stems were written.
        Assert.Single(storage.Blobs);
    }

    [Fact]
    public async Task ClaimNextQueuedAsync_ClaimsOldestFirst_AndMarksProcessing()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var older = DateTimeOffset.UtcNow.AddMinutes(-5);

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "newer", "owner/newer/mix", older.AddMinutes(1)));
            db.SeparationJobs.Add(NewQueuedJob("owner", "older", "owner/older/mix", older));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var processor = new SeparationJobProcessor(db, storage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);
            var claimed = await processor.ClaimNextQueuedAsync();

            Assert.NotNull(claimed);
            Assert.Equal("older", claimed!.Id);
            Assert.Equal(JobStatus.Processing, claimed.Status);
        }
    }

    [Fact]
    public async Task ProcessNextAsync_ReturnsFalse_WhenQueueEmpty()
    {
        using var harness = new StemDbHarness();
        var storage = new InMemoryStemStorage();

        await using var db = harness.CreateContext();
        var processor = new SeparationJobProcessor(db, storage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);

        Assert.False(await processor.ProcessNextAsync());
    }

    [Fact]
    public async Task ProcessNextAsync_ClaimsAndCompletesQueuedJob()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var mixPath = storage.SeedMix("owner", "job", StemAudioFixtures.CreateMixWav());

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", mixPath, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var processor = new SeparationJobProcessor(db, storage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);
            Assert.True(await processor.ProcessNextAsync());
        }

        await using (var verify = harness.CreateContext())
        {
            Assert.Equal(JobStatus.Completed, (await verify.SeparationJobs.SingleAsync()).Status);
        }
    }
}
