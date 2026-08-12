using System.Globalization;
using System.Text.Json;

namespace Cadence.Api.Ai;

/// <summary>
/// Turns a language model's raw text into a validated list of <see cref="AiNote"/>, applying
/// the <b>same</b> defensive clamping the on-device importers use
/// (<c>apps/web/src/composer/model/persistence.ts</c> <c>coerceNote</c>) so a hallucinated or
/// malformed response can never inject NaN, out-of-range, or negative notes into the composer.
/// The parser is deliberately tolerant of the ways a general text model wraps JSON (code
/// fences, surrounding prose, a bare array vs a <c>{ "notes": [...] }</c> object) and returns
/// <see langword="null"/> only when no usable JSON can be recovered.
/// </summary>
public static class AiNoteParser
{
    /// <summary>
    /// Parse and clamp the model output, or return <see langword="null"/> when the text
    /// contains no recoverable JSON note array. An empty list (valid JSON, zero notes) is
    /// returned as an empty list so the caller can distinguish "unusable" from "nothing".
    /// </summary>
    public static IReadOnlyList<AiNote>? TryParse(string? text, int maxNotes)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var json = ExtractJson(text);
        if (json is null)
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            JsonElement notes;
            if (root.ValueKind == JsonValueKind.Array)
            {
                notes = root;
            }
            else if (root.ValueKind == JsonValueKind.Object &&
                     TryGetProperty(root, "notes", out var notesElement) &&
                     notesElement.ValueKind == JsonValueKind.Array)
            {
                notes = notesElement;
            }
            else
            {
                return null;
            }

            var result = new List<AiNote>();
            foreach (var element in notes.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                result.Add(Clamp(
                    GetNumber(element, "pitch", 60),
                    GetNumber(element, "start", 0),
                    GetNumber(element, "duration", 1),
                    GetNumber(element, "velocity", 0.8)));

                if (result.Count >= maxNotes)
                {
                    break;
                }
            }

            return result;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Clamp one note to the composer's live-state invariants, mirroring <c>coerceNote</c>:
    /// non-finite values fall back to the same defaults, then pitch is rounded to 0–127, start
    /// floored at 0, duration floored at 1/16 beat, and velocity clamped to 0–1.
    /// </summary>
    public static AiNote Clamp(double pitch, double start, double duration, double velocity)
    {
        var safePitch = double.IsFinite(pitch) ? pitch : 60;
        var safeStart = double.IsFinite(start) ? start : 0;
        var safeDuration = double.IsFinite(duration) ? duration : 1;
        var safeVelocity = double.IsFinite(velocity) ? velocity : 0.8;

        return new AiNote(
            Math.Clamp((int)Math.Round(safePitch, MidpointRounding.AwayFromZero), 0, 127),
            Math.Max(0, safeStart),
            Math.Max(1.0 / 16, safeDuration),
            Math.Clamp(safeVelocity, 0, 1));
    }

    // Isolate the JSON payload from a model response that may wrap it in a ```json fence or
    // surround it with prose. Prefers an enclosing object (the { "notes": [...] } shape) and
    // otherwise falls back to the outermost array.
    private static string? ExtractJson(string text)
    {
        var trimmed = text.Trim();

        var fence = trimmed.IndexOf("```", StringComparison.Ordinal);
        if (fence >= 0)
        {
            var newline = trimmed.IndexOf('\n', fence);
            var close = trimmed.IndexOf("```", fence + 3, StringComparison.Ordinal);
            if (newline >= 0 && close > newline)
            {
                trimmed = trimmed[(newline + 1)..close].Trim();
            }
        }

        var objectStart = trimmed.IndexOf('{');
        var objectEnd = trimmed.LastIndexOf('}');
        var arrayStart = trimmed.IndexOf('[');
        var arrayEnd = trimmed.LastIndexOf(']');

        var hasObject = objectStart >= 0 && objectEnd > objectStart;
        var hasArray = arrayStart >= 0 && arrayEnd > arrayStart;

        if (hasObject && (!hasArray || objectStart < arrayStart))
        {
            return trimmed[objectStart..(objectEnd + 1)];
        }

        if (hasArray)
        {
            return trimmed[arrayStart..(arrayEnd + 1)];
        }

        return hasObject ? trimmed[objectStart..(objectEnd + 1)] : null;
    }

    // Case-insensitive property read (the model is prompted for lowercase keys, but tolerate
    // Pitch/PITCH etc.), accepting a JSON number or a numeric string.
    private static double GetNumber(JsonElement obj, string name, double fallback)
    {
        if (!TryGetProperty(obj, name, out var value))
        {
            return fallback;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDouble(out var number) => number,
            JsonValueKind.String when double.TryParse(
                value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
            _ => fallback,
        };
    }

    private static bool TryGetProperty(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.TryGetProperty(name, out value))
        {
            return true;
        }

        foreach (var property in obj.EnumerateObject())
        {
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase))
            {
                value = property.Value;
                return true;
            }
        }

        value = default;
        return false;
    }
}
