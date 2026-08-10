namespace Cadence.Api.Collaboration;

/// <summary>
/// Durable persistence for a collaboration room's Yjs document. Implementations
/// load the stored update log when a room's first peer joins and replace it when
/// the last peer leaves, so a room survives all collaborators disconnecting.
/// </summary>
public interface ICollabDocumentStore
{
    /// <summary>
    /// Load the persisted update log for an owner-scoped project, or an empty list
    /// when nothing has been stored yet.
    /// </summary>
    Task<IReadOnlyList<byte[]>> LoadAsync(string ownerId, string projectId, CancellationToken cancellationToken);

    /// <summary>
    /// Persist <paramref name="updates"/> as the project's durable document,
    /// replacing any prior state (upsert).
    /// </summary>
    Task SaveAsync(string ownerId, string projectId, IReadOnlyList<byte[]> updates, CancellationToken cancellationToken);
}
