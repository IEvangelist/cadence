namespace Cadence.Data.Entities;

/// <summary>
/// A persisted composer project owned by a single user. The composition document
/// itself is stored as an opaque, versioned JSON string in <see cref="Data"/> —
/// the same shape the web client serializes — so the relational schema stays
/// provider-agnostic and forward-compatible with the client's migration seam.
/// </summary>
public sealed class ProjectEntity
{
    /// <summary>Primary key. Mirrors the client-side project id when provided.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Foreign key to the owning user; authorization is scoped by this.</summary>
    public string OwnerId { get; set; } = string.Empty;

    /// <summary>Display name of the project.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Client persistence schema version of <see cref="Data"/>.</summary>
    public int SchemaVersion { get; set; }

    /// <summary>Serialized composition document (JSON), stored verbatim.</summary>
    public string Data { get; set; } = string.Empty;

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Last-updated timestamp (UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Navigation to the owning user.</summary>
    public ApplicationUser? Owner { get; set; }
}
