using Cadence.Data.Stems;

namespace Cadence.Data.Entities;

/// <summary>
/// A single separated stem belonging to a <see cref="SeparationJob"/>. The key is
/// composite (<see cref="OwnerId"/> + <see cref="JobId"/> + <see cref="Label"/>):
/// carrying the owner id on the row lets every stem read stay owner-scoped without
/// a join, so a stem belonging to another user is a 404, never a leak (no IDOR).
/// </summary>
public sealed class SeparationStem
{
    /// <summary>Owning user id (part of the composite key; scopes authorization).</summary>
    public string OwnerId { get; set; } = string.Empty;

    /// <summary>Parent job id (part of the composite key).</summary>
    public string JobId { get; set; } = string.Empty;

    /// <summary>Which instrument/source this stem isolates.</summary>
    public StemLabel Label { get; set; }

    /// <summary>Blob path of the stored stem audio (never a public URL).</summary>
    public string BlobPath { get; set; } = string.Empty;

    /// <summary>Size of the stem audio in bytes.</summary>
    public long SizeBytes { get; set; }

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Navigation to the parent job.</summary>
    public SeparationJob? Job { get; set; }
}
