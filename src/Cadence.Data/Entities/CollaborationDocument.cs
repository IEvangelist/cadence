namespace Cadence.Data.Entities;

/// <summary>
/// The durable server-side copy of a collaborative project's Yjs document, stored
/// as an opaque, ordered log of update payloads (see <c>CollabDocumentCodec</c>).
///
/// The live relay is an in-memory broadcaster that prunes a room once its last
/// peer leaves, so without this record a project's shared edits would exist only
/// in the connected clients' memory/localStorage. Persisting the update log on
/// last-leave — and replaying it to a lone reconnecting collaborator — lets a room
/// survive all peers disconnecting and later reconvene with state intact.
/// </summary>
public sealed class CollaborationDocument
{
    /// <summary>Owner of the project (the composite project key part).</summary>
    public string OwnerId { get; set; } = string.Empty;

    /// <summary>Id of the project (the composite project key part).</summary>
    public string ProjectId { get; set; } = string.Empty;

    /// <summary>
    /// The encoded Yjs update log — a length-prefixed concatenation of the update
    /// payloads applied during collaboration. Opaque to the database.
    /// </summary>
    public byte[] State { get; set; } = [];

    /// <summary>When the document was last persisted (UTC).</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Navigation to the owning project.</summary>
    public ProjectEntity? Project { get; set; }
}
