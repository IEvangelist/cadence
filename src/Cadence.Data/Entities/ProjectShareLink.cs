namespace Cadence.Data.Entities;

/// <summary>
/// A server-issued share link that grants a <see cref="CollaborationRole"/> on a
/// specific owner-scoped project. The opaque <see cref="Token"/> is the bearer
/// secret embedded in a share URL; the relay resolves it to the project + role
/// server-side, so a collaborator can never claim a role the owner did not grant.
/// </summary>
public sealed class ProjectShareLink
{
    /// <summary>Primary key — the opaque, unguessable share token.</summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>Owner of the shared project (the composite project key part).</summary>
    public string OwnerId { get; set; } = string.Empty;

    /// <summary>Id of the shared project (the composite project key part).</summary>
    public string ProjectId { get; set; } = string.Empty;

    /// <summary>The role this link grants. Never <see cref="CollaborationRole.Owner"/>.</summary>
    public CollaborationRole Role { get; set; } = CollaborationRole.Viewer;

    /// <summary>Creation timestamp (UTC).</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Navigation to the shared project.</summary>
    public ProjectEntity? Project { get; set; }
}
