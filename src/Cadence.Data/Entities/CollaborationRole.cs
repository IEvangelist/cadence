namespace Cadence.Data.Entities;

/// <summary>
/// The permission a collaborator holds on a shared project. Enforced
/// server-side by the collaboration relay: only <see cref="Owner"/> and
/// <see cref="Editor"/> may mutate the shared document; <see cref="Viewer"/> is
/// strictly read-only.
/// </summary>
public enum CollaborationRole
{
    /// <summary>The project owner. Full read/write plus share management.</summary>
    Owner = 0,

    /// <summary>May read and write the shared document.</summary>
    Editor = 1,

    /// <summary>Read-only. Write frames from this role are rejected.</summary>
    Viewer = 2,
}
