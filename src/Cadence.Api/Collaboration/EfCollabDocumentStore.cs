using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Collaboration;

/// <summary>
/// EF Core-backed <see cref="ICollabDocumentStore"/>. The relay hub is a singleton
/// that outlives any request scope, so each load/save resolves a fresh scoped
/// <see cref="CadenceDbContext"/> from <see cref="IServiceScopeFactory"/> rather
/// than capturing one — keeping DbContext usage single-threaded and short-lived.
/// </summary>
public sealed class EfCollabDocumentStore(IServiceScopeFactory scopeFactory) : ICollabDocumentStore
{
    /// <inheritdoc />
    public async Task<IReadOnlyList<byte[]>> LoadAsync(string ownerId, string projectId, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();

        var document = await db.CollaborationDocuments
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.OwnerId == ownerId && d.ProjectId == projectId, cancellationToken);

        return CollabDocumentCodec.Decode(document?.State);
    }

    /// <inheritdoc />
    public async Task SaveAsync(string ownerId, string projectId, IReadOnlyList<byte[]> updates, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();

        var state = CollabDocumentCodec.Encode(updates);
        var existing = await db.CollaborationDocuments
            .FirstOrDefaultAsync(d => d.OwnerId == ownerId && d.ProjectId == projectId, cancellationToken);

        if (existing is null)
        {
            db.CollaborationDocuments.Add(new CollaborationDocument
            {
                OwnerId = ownerId,
                ProjectId = projectId,
                State = state,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            existing.State = state;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
