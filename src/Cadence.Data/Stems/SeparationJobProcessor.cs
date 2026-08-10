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
        // Candidate queued jobs, oldest first. Ordering is client-side because SQLite
        // (which backs the unit tests) cannot ORDER BY a DateTimeOffset and the queued
        // set is small; the projection is untracked so nothing lands in the change
        // tracker ahead of the atomic claim below.
        var candidates = await _db.SeparationJobs
            .Where(j => j.Status == JobStatus.Queued)
            .Select(j => new { j.OwnerId, j.Id, j.CreatedAt })
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates.OrderBy(c => c.CreatedAt))
        {
            var now = DateTimeOffset.UtcNow;

            // Atomic conditional claim: the UPDATE only matches while the row is still
            // Queued, so if another replica claimed it first this affects zero rows and
            // we try the next candidate. This is the cross-provider equivalent of
            // SELECT ... FOR UPDATE SKIP LOCKED and makes scale-out (WithReplicas) safe:
            // two workers can never both flip the same job to Processing. The attempt
            // count and lease stamp are set in the same statement for the reaper.
            var claimed = await _db.SeparationJobs
                .Where(j => j.OwnerId == candidate.OwnerId && j.Id == candidate.Id && j.Status == JobStatus.Queued)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(j => j.Status, JobStatus.Processing)
                    .SetProperty(j => j.Attempts, j => j.Attempts + 1)
                    .SetProperty(j => j.ProcessingStartedAt, now)
                    .SetProperty(j => j.UpdatedAt, now),
                    cancellationToken);

            if (claimed == 1)
            {
                // Return the freshly-claimed row (tracked) so the caller can process it.
                return await _db.SeparationJobs
                    .FirstAsync(j => j.OwnerId == candidate.OwnerId && j.Id == candidate.Id, cancellationToken);
            }
        }

        return null;
    }

    /// <summary>
    /// Reclaim jobs stuck in <see cref="JobStatus.Processing"/> past their lease (their
    /// worker died mid-run, so they would otherwise never terminate and the owner would
    /// poll forever). A job under <paramref name="maxAttempts"/> is returned to
    /// <see cref="JobStatus.Queued"/> for another attempt; once its attempts are
    /// exhausted it is moved to <see cref="JobStatus.Failed"/>. Returns the number of
    /// jobs reclaimed. Safe to run from multiple replicas: each transition is a
    /// conditional UPDATE guarded on the row still being <c>Processing</c>, so only one
    /// reaper (or the completing worker) ever wins.
    /// </summary>
    public async Task<int> ReclaimTimedOutJobsAsync(
        TimeSpan leaseTimeout,
        int maxAttempts,
        CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now - leaseTimeout;

        // Load the (small, worker-bounded) in-flight set untracked and filter the lease
        // client-side: SQLite cannot translate a DateTimeOffset comparison.
        var inFlight = await _db.SeparationJobs
            .AsNoTracking()
            .Where(j => j.Status == JobStatus.Processing)
            .Select(j => new { j.OwnerId, j.Id, j.Attempts, j.ProcessingStartedAt })
            .ToListAsync(cancellationToken);

        var reclaimed = 0;
        foreach (var job in inFlight)
        {
            // A job with no lease stamp is treated as freshly claimed, never stuck.
            if (job.ProcessingStartedAt is null || job.ProcessingStartedAt > cutoff)
            {
                continue;
            }

            int affected;
            if (job.Attempts >= maxAttempts)
            {
                affected = await _db.SeparationJobs
                    .Where(j => j.OwnerId == job.OwnerId && j.Id == job.Id && j.Status == JobStatus.Processing)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(j => j.Status, JobStatus.Failed)
                        .SetProperty(j => j.ErrorMessage, Truncate($"Abandoned after {job.Attempts} attempt(s): processing lease expired."))
                        .SetProperty(j => j.CompletedAt, now)
                        .SetProperty(j => j.UpdatedAt, now),
                        cancellationToken);
                if (affected == 1)
                {
                    _logger.LogWarning("Job {JobId} failed after {Attempts} stalled attempt(s).", job.Id, job.Attempts);
                }
            }
            else
            {
                affected = await _db.SeparationJobs
                    .Where(j => j.OwnerId == job.OwnerId && j.Id == job.Id && j.Status == JobStatus.Processing)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(j => j.Status, JobStatus.Queued)
                        .SetProperty(j => j.ProcessingStartedAt, (DateTimeOffset?)null)
                        .SetProperty(j => j.UpdatedAt, now),
                        cancellationToken);
                if (affected == 1)
                {
                    _logger.LogInformation("Requeued stalled job {JobId} (attempt {Attempts}).", job.Id, job.Attempts);
                }
            }

            reclaimed += affected;
        }

        return reclaimed;
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
