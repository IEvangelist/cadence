namespace Cadence.Api.Ai;

/// <summary>
/// Configuration for the optional, local-only server-side AI generation endpoint (#140),
/// bound from the <c>Ai:ServerSide</c> section. The feature is <b>default OFF</b>: when
/// <see cref="Enabled"/> is false the endpoint is never mapped (callers get 404) and no
/// Ollama client is resolved, so the default experience is unchanged and nothing
/// AI-related runs in CI or a normal build/F5.
/// </summary>
public sealed class AiGenerationOptions
{
    /// <summary>Configuration section these options bind from.</summary>
    public const string SectionName = "Ai:ServerSide";

    /// <summary>
    /// Master switch. Default <see langword="false"/>: the endpoint is not mapped and the
    /// Ollama <c>IChatClient</c> is not registered. Turning it on requires a developer to
    /// have started the local Ollama resource in the Aspire dashboard.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// The Aspire connection/resource name of the referenced Ollama model. Matches
    /// <c>ollama.AddModel("ollama-model", …)</c> in the AppHost; its connection string is
    /// present only while a developer has started the explicit-start Ollama resource.
    /// </summary>
    public string ConnectionName { get; set; } = "ollama-model";

    /// <summary>
    /// Hard upper bound on the number of notes accepted from a single model response, so a
    /// hallucinated mega-array is truncated rather than returned or persisted. Mirrors the
    /// defensive clamping discipline the on-device importers apply.
    /// </summary>
    public int MaxNotes { get; set; } = 512;
}
