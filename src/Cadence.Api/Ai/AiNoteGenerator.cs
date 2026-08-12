using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;

namespace Cadence.Api.Ai;

/// <summary>The outcome category of a server-side generation, mapped to an HTTP status by the endpoint.</summary>
public enum AiGenerationStatus
{
    /// <summary>Notes were generated and validated.</summary>
    Success,

    /// <summary>The local Ollama model is not running (no <see cref="IChatClient"/> resolved) → 503.</summary>
    Unavailable,

    /// <summary>The model responded but produced no usable JSON notes → 422.</summary>
    InvalidModelOutput,
}

/// <summary>The result of a generation attempt.</summary>
public sealed record AiGenerationResult(AiGenerationStatus Status, IReadOnlyList<AiNote> Notes, string Label)
{
    /// <summary>The local model is unavailable.</summary>
    public static AiGenerationResult Unavailable { get; } =
        new(AiGenerationStatus.Unavailable, [], string.Empty);

    /// <summary>The model output could not be parsed into notes.</summary>
    public static AiGenerationResult Invalid { get; } =
        new(AiGenerationStatus.InvalidModelOutput, [], string.Empty);

    /// <summary>A successful generation.</summary>
    public static AiGenerationResult Ok(IReadOnlyList<AiNote> notes, string label) =>
        new(AiGenerationStatus.Success, notes, label);
}

/// <summary>
/// Generates notes by prompting the Aspire-referenced local Ollama model through the
/// Microsoft.Extensions.AI <see cref="IChatClient"/> abstraction (so it is trivially mockable
/// in tests). The <see cref="IChatClient"/> is resolved <em>optionally</em>: when the feature
/// is enabled but a developer has not started Ollama its connection string is absent and no
/// client is registered, which surfaces as <see cref="AiGenerationStatus.Unavailable"/> (503)
/// rather than a startup failure or a 500. All model output flows through
/// <see cref="AiNoteParser"/>, so malformed responses are clamped or rejected, never trusted.
/// </summary>
public sealed class AiNoteGenerator(
    IServiceProvider services,
    IOptions<AiGenerationOptions> options,
    ILogger<AiNoteGenerator> logger)
{
    private static readonly string[] KnownActions = ["continue", "generate", "harmonize"];

    private readonly IServiceProvider _services = services;
    private readonly AiGenerationOptions _options = options.Value;
    private readonly ILogger<AiNoteGenerator> _logger = logger;

    /// <summary>Whether a local model client is currently resolvable (Ollama started).</summary>
    public bool IsAvailable => _services.GetService<IChatClient>() is not null;

    /// <summary>True when <paramref name="action"/> is one of the supported assistant actions.</summary>
    public static bool IsKnownAction(string? action) =>
        action is not null && Array.IndexOf(KnownActions, action.ToLowerInvariant()) >= 0;

    /// <summary>Generate notes for the request, or report why generation could not complete.</summary>
    public async Task<AiGenerationResult> GenerateAsync(AiGenerateRequest request, CancellationToken cancellationToken)
    {
        var chat = _services.GetService<IChatClient>();
        if (chat is null)
        {
            return AiGenerationResult.Unavailable;
        }

        var messages = BuildMessages(request);
        var chatOptions = new ChatOptions
        {
            // Keep the model's own sampling in the composer's advertised range.
            Temperature = (float)Math.Clamp(request.Params.Temperature, 0.1, 2.0),
            // Ask Ollama for strict JSON; the parser still defends against non-compliance.
            ResponseFormat = ChatResponseFormat.Json,
        };

        ChatResponse response;
        try
        {
            response = await chat.GetResponseAsync(messages, chatOptions, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // A transport error to a model that was started then stopped mid-flight is a
            // service-availability problem, not an unhandled server fault.
            _logger.LogWarning(ex, "Local AI generation request to Ollama failed.");
            return AiGenerationResult.Unavailable;
        }

        var notes = AiNoteParser.TryParse(response.Text, _options.MaxNotes);
        if (notes is null || notes.Count == 0)
        {
            _logger.LogWarning("Local AI generation returned no usable notes from the model output.");
            return AiGenerationResult.Invalid;
        }

        return AiGenerationResult.Ok(notes, BuildLabel(request));
    }

    private static List<ChatMessage> BuildMessages(AiGenerateRequest request)
    {
        const string system =
            "You are a music composition assistant for a piano-roll editor. " +
            "Respond with ONLY strict JSON and nothing else — no prose, no markdown, no code fences. " +
            "The JSON must be an object of the form " +
            "{\"notes\":[{\"pitch\":<integer 0-127>,\"start\":<number>,\"duration\":<number>,\"velocity\":<number>}]}. " +
            "\"start\" and \"duration\" are in beats (quarter notes); \"start\" is >= 0 and \"duration\" is > 0. " +
            "\"pitch\" is a MIDI note number 0-127. \"velocity\" is normalized between 0 and 1. " +
            "Do not include any keys other than pitch, start, duration, and velocity.";

        var action = request.Action.ToLowerInvariant();
        var beats = Math.Max(1, (int)Math.Round(request.Params.LengthBeats, MidpointRounding.AwayFromZero));
        var seedJson = JsonSerializer.Serialize(request.SeedNotes);

        var instruction = action switch
        {
            "generate" =>
                $"Compose a new melody of about {beats} beats starting at beat {request.RegionStart:0.###} " +
                $"at {request.Tempo:0.###} BPM.",
            "harmonize" =>
                $"Harmonize the following notes with chords, producing about {beats} beats starting at beat " +
                $"{request.RegionStart:0.###} at {request.Tempo:0.###} BPM. Seed notes: {seedJson}.",
            _ =>
                $"Continue the following melody for about {beats} more beats at {request.Tempo:0.###} BPM, " +
                $"beginning at beat {request.RegionStart:0.###}. Seed notes: {seedJson}.",
        };

        return
        [
            new ChatMessage(ChatRole.System, system),
            new ChatMessage(ChatRole.User, instruction),
        ];
    }

    // Mirror the on-device status labels ("Continued 8 beats", "Generated 8 beats", ...).
    private static string BuildLabel(AiGenerateRequest request)
    {
        var beats = Math.Max(1, (int)Math.Round(request.Params.LengthBeats, MidpointRounding.AwayFromZero));
        var verb = request.Action.ToLowerInvariant() switch
        {
            "generate" => "Generated",
            "harmonize" => "Harmonized",
            _ => "Continued",
        };
        return $"{verb} {beats} beats";
    }
}
