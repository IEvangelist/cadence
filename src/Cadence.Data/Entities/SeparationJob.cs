using Cadence.Data.Stems;

namespace Cadence.Data.Entities;

/// <summary>
/// An owner-scoped stem-separation job: an uploaded mix that is separated into a
/// set of labeled <see cref="SeparationStem"/> tracks by the background worker.
/// The key is composite (<see cref="OwnerId"/> + <see cref="Id"/>), mirroring
/// <see cref="ProjectEntity"/>: a job id is unique per user, never globally, so a
/// job belonging to another user is indistinguishable from a missing one (no
/// cross-tenant existence oracle, no IDOR).
/// </summary>
public sealed class SeparationJob
{
    /// <summary>Primary key (per-owner). A server-generated opaque id.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Foreign key to the owning user; all authorization is scoped by this.</summary>
    public string OwnerId { get; set; } = string.Empty;

    /// <summary>Current lifecycle state.</summary>
    public JobStatus Status { get; set; } = JobStatus.Queued;

    /// <summary>Original (client-supplied) file name of the uploaded mix.</summary>
    public string OriginalFileName { get; set; } = string.Empty;

    /// <summary>Content type of the uploaded mix (validated on upload).</summary>
    public string ContentType { get; set; } = string.Empty;

    /// <summary>Size of the uploaded mix in bytes.</summary>
    public long SizeBytes { get; set; }

    /// <summary>Blob path of the stored mix (never a public URL).</summary>
    public string MixBlobPath { get; set; } = string.Empty;

    /// <summary>Populated when <see cref="Status"/> is <see cref="JobStatus.Failed"/>.</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Last-updated timestamp (UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Completion timestamp (UTC), set when the job reaches a terminal state.</summary>
    public DateTimeOffset? CompletedAt { get; set; }

    /// <summary>Navigation to the owning user.</summary>
    public ApplicationUser? Owner { get; set; }

    /// <summary>The separated stems produced by this job.</summary>
    public List<SeparationStem> Stems { get; set; } = [];
}
