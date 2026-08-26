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

public sealed record AntiforgeryTokenResponse(string RequestToken);

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

/// <summary>Lightweight stem-separation job listing entry.</summary>
public sealed record StemJobSummary(
    string Id,
    string Status,
    string OriginalFileName,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CompletedAt);

/// <summary>One separated stem in a job detail (with its owner-scoped download URL).</summary>
public sealed record StemInfo(string Label, long SizeBytes, string Url);

/// <summary>Full stem-separation job, including its stems once completed.</summary>
public sealed record StemJobDetail(
    string Id,
    string Status,
    string OriginalFileName,
    string ContentType,
    long SizeBytes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? CompletedAt,
    string? ErrorMessage,
    IReadOnlyList<StemInfo> Stems);

// The server-side AI generation contract (#140) deliberately mirrors the on-device
// assistant's shape in apps/web/src/composer/ai/types.ts so the endpoint is a true
// drop-in for low-power devices: the request is an AssistantRequest and the response
// an AssistantSuggestion. Field names serialize camelCase (the minimal-API default),
// matching the browser's { action, notes:[{pitch,start,duration,velocity}], label }.

/// <summary>
/// A single note in the composer's units, mirroring the on-device <c>SuggestedNote</c>:
/// MIDI <paramref name="Pitch"/> 0–127, <paramref name="Start"/>/<paramref name="Duration"/>
/// in beats (quarter notes), and normalized <paramref name="Velocity"/> 0–1.
/// </summary>
public sealed record AiNote(int Pitch, double Start, double Duration, double Velocity);

/// <summary>Sampling knobs for a generation (mirrors the on-device <c>AssistantParams</c>).</summary>
/// <param name="Temperature">Sampling temperature; higher is more adventurous (typical 0.1–2.0).</param>
/// <param name="LengthBeats">How many beats of material to produce.</param>
public sealed record AiGenerateParams(double Temperature, double LengthBeats);

/// <summary>
/// Request to generate notes server-side (mirrors the on-device <c>AssistantRequest</c>,
/// minus the client-only cancellation signal).
/// </summary>
/// <param name="Action"><c>continue</c>, <c>generate</c>, or <c>harmonize</c>.</param>
/// <param name="SeedNotes">Existing notes giving the model context (may be empty for <c>generate</c>).</param>
/// <param name="RegionStart">Beat position where generated material should begin.</param>
/// <param name="Tempo">Tempo in BPM.</param>
/// <param name="Params">Sampling parameters.</param>
public sealed record AiGenerateRequest(
    string Action,
    IReadOnlyList<AiNote> SeedNotes,
    double RegionStart,
    double Tempo,
    AiGenerateParams Params);

/// <summary>
/// The generated suggestion (mirrors the on-device <c>AssistantSuggestion</c>): the notes to
/// preview plus a short human label such as "Continued 8 beats".
/// </summary>
public sealed record AiGenerateResponse(
    string Action,
    IReadOnlyList<AiNote> Notes,
    string Label);
