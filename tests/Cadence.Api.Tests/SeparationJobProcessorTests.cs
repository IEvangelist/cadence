using Cadence.Data;
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

    private static SeparationJob NewProcessingJob(string ownerId, string jobId, DateTimeOffset startedAt, int attempts) => new()
    {
        Id = jobId,
        OwnerId = ownerId,
        Status = JobStatus.Processing,
        OriginalFileName = "mix.wav",
        ContentType = "audio/wav",
        MixBlobPath = $"{ownerId}/{jobId}/mix",
        SizeBytes = 1,
        CreatedAt = startedAt,
        UpdatedAt = startedAt,
        ProcessingStartedAt = startedAt,
        Attempts = attempts,
    };

    private static SeparationJobProcessor NewProcessor(CadenceDbContext db, IStemStorage storage) =>
        new(db, storage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);

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

    [Fact]
    public async Task ClaimNextQueuedAsync_StampsLease_AndIncrementsAttempts()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", "owner/job/mix", DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var claimed = await NewProcessor(db, storage).ClaimNextQueuedAsync();

            Assert.NotNull(claimed);
            Assert.Equal(JobStatus.Processing, claimed!.Status);
            Assert.Equal(1, claimed.Attempts);
            Assert.NotNull(claimed.ProcessingStartedAt);
        }
    }

    [Fact]
    public async Task ClaimNextQueuedAsync_TwoWorkers_OnlyOneClaimsTheSameJob()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", "owner/job/mix", DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        // Two independent processors (two DbContexts standing in for two worker
        // replicas) both go after the single queued job.
        await using var dbA = harness.CreateContext();
        await using var dbB = harness.CreateContext();
        var claimedA = await NewProcessor(dbA, storage).ClaimNextQueuedAsync();
        var claimedB = await NewProcessor(dbB, storage).ClaimNextQueuedAsync();

        // Exactly one replica wins; the other sees an empty queue.
        Assert.True((claimedA is null) ^ (claimedB is null));

        await using var verify = harness.CreateContext();
        var job = await verify.SeparationJobs.SingleAsync();
        Assert.Equal(JobStatus.Processing, job.Status);
        Assert.Equal(1, job.Attempts);
        Assert.NotNull(job.ProcessingStartedAt);
    }

    [Fact]
    public async Task AtomicClaim_WhenBothReplicasSeeQueued_ExactlyOneUpdateWins()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "job", "owner/job/mix", DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        // Both replicas observe the row as Queued, then each issues the guarded claim.
        // The database serialises the two UPDATEs: the first flips Queued -> Processing,
        // the second matches zero rows. This is the atomicity L3 asks for.
        var now = DateTimeOffset.UtcNow;
        static Task<int> ClaimAsync(CadenceDbContext db, DateTimeOffset now) =>
            db.SeparationJobs
                .Where(j => j.OwnerId == "owner" && j.Id == "job" && j.Status == JobStatus.Queued)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(j => j.Status, JobStatus.Processing)
                    .SetProperty(j => j.Attempts, j => j.Attempts + 1)
                    .SetProperty(j => j.ProcessingStartedAt, now));

        await using var dbA = harness.CreateContext();
        await using var dbB = harness.CreateContext();
        var winnersA = await ClaimAsync(dbA, now);
        var winnersB = await ClaimAsync(dbB, now);

        Assert.Equal(1, winnersA + winnersB);
    }

    [Fact]
    public async Task ReclaimTimedOutJobsAsync_RequeuesStaleJob_WhenUnderMaxAttempts()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var stale = DateTimeOffset.UtcNow.AddMinutes(-10);

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewProcessingJob("owner", "job", stale, attempts: 1));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var reclaimed = await NewProcessor(db, storage)
                .ReclaimTimedOutJobsAsync(TimeSpan.FromMinutes(1), maxAttempts: 3);
            Assert.Equal(1, reclaimed);
        }

        await using (var verify = harness.CreateContext())
        {
            var job = await verify.SeparationJobs.SingleAsync();
            Assert.Equal(JobStatus.Queued, job.Status);
            Assert.Null(job.ProcessingStartedAt);
            Assert.Equal(1, job.Attempts);
            Assert.Null(job.ErrorMessage);
        }
    }

    [Fact]
    public async Task ReclaimTimedOutJobsAsync_FailsStaleJob_WhenAttemptsExhausted()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var stale = DateTimeOffset.UtcNow.AddMinutes(-10);

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewProcessingJob("owner", "job", stale, attempts: 3));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var reclaimed = await NewProcessor(db, storage)
                .ReclaimTimedOutJobsAsync(TimeSpan.FromMinutes(1), maxAttempts: 3);
            Assert.Equal(1, reclaimed);
        }

        await using (var verify = harness.CreateContext())
        {
            var job = await verify.SeparationJobs.SingleAsync();
            Assert.Equal(JobStatus.Failed, job.Status);
            Assert.NotNull(job.CompletedAt);
            Assert.NotNull(job.ErrorMessage);
        }
    }

    [Fact]
    public async Task ReclaimTimedOutJobsAsync_LeavesFreshProcessingJob_Untouched()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewProcessingJob("owner", "job", DateTimeOffset.UtcNow, attempts: 1));
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var reclaimed = await NewProcessor(db, storage)
                .ReclaimTimedOutJobsAsync(TimeSpan.FromMinutes(5), maxAttempts: 3);
            Assert.Equal(0, reclaimed);
        }

        await using (var verify = harness.CreateContext())
        {
            Assert.Equal(JobStatus.Processing, (await verify.SeparationJobs.SingleAsync()).Status);
        }
    }

    [Fact]
    public async Task ReclaimTimedOutJobsAsync_IgnoresQueuedAndTerminalJobs()
    {
        using var harness = new StemDbHarness();
        await harness.SeedOwnerAsync("owner");
        var storage = new InMemoryStemStorage();
        var old = DateTimeOffset.UtcNow.AddHours(-1);

        await using (var db = harness.CreateContext())
        {
            db.SeparationJobs.Add(NewQueuedJob("owner", "queued", "owner/queued/mix", old));
            db.SeparationJobs.Add(new SeparationJob
            {
                Id = "done",
                OwnerId = "owner",
                Status = JobStatus.Completed,
                OriginalFileName = "mix.wav",
                ContentType = "audio/wav",
                MixBlobPath = "owner/done/mix",
                SizeBytes = 1,
                CreatedAt = old,
                UpdatedAt = old,
                CompletedAt = old,
            });
            await db.SaveChangesAsync();
        }

        await using (var db = harness.CreateContext())
        {
            var reclaimed = await NewProcessor(db, storage)
                .ReclaimTimedOutJobsAsync(TimeSpan.FromMinutes(1), maxAttempts: 3);
            Assert.Equal(0, reclaimed);
        }

        await using (var verify = harness.CreateContext())
        {
            Assert.Equal(JobStatus.Queued, (await verify.SeparationJobs.SingleAsync(j => j.Id == "queued")).Status);
            Assert.Equal(JobStatus.Completed, (await verify.SeparationJobs.SingleAsync(j => j.Id == "done")).Status);
        }
    }
}
