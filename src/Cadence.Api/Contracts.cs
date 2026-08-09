namespace Cadence.Api;

/// <summary>Request to register a local (email + password) account.</summary>
public sealed record RegisterRequest(string Email, string Password, string? DisplayName);

/// <summary>Request to sign in with a local account.</summary>
public sealed record LoginRequest(string Email, string Password);

/// <summary>Request a passwordless magic-link sign-in email.</summary>
public sealed record MagicLinkRequest(string Email);

/// <summary>The signed-in user's identity summary.</summary>
public sealed record MeResponse(string Id, string Email, string DisplayName, string Tier);

/// <summary>Full profile projection returned by the profile endpoints.</summary>
public sealed record ProfileResponse(
    string Id,
    string DisplayName,
    string? Bio,
    string? AvatarUrl,
    string Tier,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>Editable profile fields. Null fields are left unchanged.</summary>
public sealed record UpdateProfileRequest(string? DisplayName, string? Bio, string? AvatarUrl);

/// <summary>Lightweight project listing entry.</summary>
public sealed record ProjectSummary(
    string Id,
    string Name,
    int SchemaVersion,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>Full project including the serialized composition document.</summary>
public sealed record ProjectDetail(
    string Id,
    string Name,
    int SchemaVersion,
    string Data,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>Create/update payload for a project.</summary>
public sealed record SaveProjectRequest(string? Id, string Name, int SchemaVersion, string Data);

/// <summary>Request to mint a share link. Role is <c>editor</c> or <c>viewer</c>.</summary>
public sealed record CreateShareLinkRequest(string Role);

/// <summary>A server-issued collaboration share link for a project.</summary>
public sealed record ShareLinkResponse(string Token, string Role, DateTimeOffset CreatedAt);

/// <summary>The external providers currently wired (for rendering sign-in buttons).</summary>
public sealed record ProvidersResponse(IReadOnlyList<string> Providers);

/// <summary>The caller's current tier and the typed entitlements it grants.</summary>
public sealed record EntitlementsResponse(
    string Tier,
    bool WatermarkExports,
    int MaxProjects,
    int AiGenerationsPerDay,
    bool AdvancedFormats,
    bool StemSeparation,
    int CollaborationSeats);

/// <summary>A URL to redirect the browser to (checkout or customer portal).</summary>
public sealed record BillingUrlResponse(string Url);
