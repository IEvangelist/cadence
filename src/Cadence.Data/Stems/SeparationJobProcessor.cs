using Cadence.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Cadence.Data.Stems;

/// <summary>
/// The heart of the async pipeline: claims a queued job, runs the configured
/// <see cref="IStemSeparator"/>, persists the labeled stems to storage, and drives
/// the job through the <see cref="SeparationJobStateMachine"/> to a terminal state.
/// It is deliberately host-agnostic (no <c>BackgroundService</c> here) so it can be
/// unit-tested directly against SQLite with fake storage and a fake separator.
/// </summary>
public sealed class SeparationJobProcessor(
    CadenceDbContext db,
    IStemStorage storage,
    IStemSeparator separator,
    ILogger<SeparationJobProcessor> logger)
{
    private const int MaxErrorLength = 1024;

    private readonly CadenceDbContext _db = db;
    private readonly IStemStorage _storage = storage;
    private readonly IStemSeparator _separator = separator;
    private readonly ILogger<SeparationJobProcessor> _logger = logger;

    /// <summary>
    /// Atomically claim the oldest queued job by moving it to
    /// <see cref="JobStatus.Processing"/>, or return <see langword="null"/> when the
    /// queue is empty.
    /// </summary>
    public async Task<SeparationJob?> ClaimNextQueuedAsync(CancellationToken cancellationToken = default)
    {
        // Order client-side by CreatedAt: SQLite (which backs the unit tests) cannot
        // ORDER BY a DateTimeOffset, and the queued set is small. A single worker
        // claims one job at a time, so load-then-claim needs no row locking here.
        var queued = await _db.SeparationJobs
            .Where(j => j.Status == JobStatus.Queued)
            .ToListAsync(cancellationToken);

        var job = queued.OrderBy(j => j.CreatedAt).FirstOrDefault();
        if (job is null)
        {
            return null;
        }

        job.Status = SeparationJobStateMachine.Transition(job.Status, JobStatus.Processing);
        job.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return job;
    }

    /// <summary>Claim and process the next queued job; returns false when idle.</summary>
    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken = default)
    {
        var job = await ClaimNextQueuedAsync(cancellationToken);
        if (job is null)
        {
            return false;
        }

        await ProcessAsync(job, cancellationToken);
        return true;
    }

    /// <summary>
    /// Run separation for an already-claimed job. All storage writes happen before
    /// any row is added to the context, so a mid-run failure never persists a
    /// partial set of stems: the job simply transitions to
    /// <see cref="JobStatus.Failed"/> with a recorded error.
    /// </summary>
    public async Task ProcessAsync(SeparationJob job, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(job);

        if (SeparationJobStateMachine.CanTransition(job.Status, JobStatus.Processing))
        {
            job.Status = JobStatus.Processing;
        }

        try
        {
            var mix = await _storage.OpenReadAsync(job.MixBlobPath, cancellationToken)
                ?? throw new InvalidOperationException($"Mix blob '{job.MixBlobPath}' is missing.");

            IReadOnlyList<SeparatedStem> stems;
            await using (mix.Content)
            {
                stems = await _separator.SeparateAsync(mix.Content, job.ContentType, cancellationToken);
            }

            var now = DateTimeOffset.UtcNow;
            var rows = new List<SeparationStem>(stems.Count);
            foreach (var stem in stems)
            {
                var path = await _storage.SaveStemAsync(job.OwnerId, job.Id, stem.Label, stem.Wav, cancellationToken);
                rows.Add(new SeparationStem
                {
                    OwnerId = job.OwnerId,
                    JobId = job.Id,
                    Label = stem.Label,
                    BlobPath = path,
                    SizeBytes = stem.Wav.LongLength,
                    CreatedAt = now,
                });
            }

            _db.SeparationStems.AddRange(rows);
            job.Status = SeparationJobStateMachine.Transition(job.Status, JobStatus.Completed);
            job.CompletedAt = now;
            job.UpdatedAt = now;
            await _db.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Separated job {JobId} into {StemCount} stems.", job.Id, rows.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Separation failed for job {JobId}.", job.Id);
            job.Status = JobStatus.Failed;
            job.ErrorMessage = Truncate(ex.Message);
            job.UpdatedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
        }
    }

    private static string Truncate(string message) =>
        message.Length <= MaxErrorLength ? message : message[..MaxErrorLength];
}
