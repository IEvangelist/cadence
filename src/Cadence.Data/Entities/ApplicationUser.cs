using Microsoft.AspNetCore.Identity;

namespace Cadence.Data.Entities;

/// <summary>
/// Application user. Extends the ASP.NET Core Identity user with a display name
/// and owns a single <see cref="UserProfile"/> plus any number of projects.
/// </summary>
public sealed class ApplicationUser : IdentityUser
{
    /// <summary>Human-friendly name shown in the UI. May be empty until set.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>The user's profile (1:1). Populated by the profile-creation seam.</summary>
    public UserProfile? Profile { get; set; }
}
