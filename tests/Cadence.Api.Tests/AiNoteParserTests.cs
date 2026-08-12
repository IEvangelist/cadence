using Cadence.Api.Ai;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for <see cref="AiNoteParser"/>: it must recover JSON notes from the loose text a
/// general model emits and apply the SAME clamping the on-device importers use
/// (<c>apps/web/src/composer/model/persistence.ts</c> <c>coerceNote</c>), so a hallucinated or
/// out-of-range response can never inject NaN, negative, or out-of-bounds notes downstream.
/// </summary>
public class AiNoteParserTests
{
    private const int MaxNotes = 512;

    [Fact]
    public void TryParse_NotesObject_ReturnsNotes()
    {
        const string json = """{"notes":[{"pitch":64,"start":0,"duration":1,"velocity":0.8}]}""";

        var notes = AiNoteParser.TryParse(json, MaxNotes);

        var note = Assert.Single(notes!);
        Assert.Equal(64, note.Pitch);
        Assert.Equal(0, note.Start);
        Assert.Equal(1, note.Duration);
        Assert.Equal(0.8, note.Velocity, 3);
    }

    [Fact]
    public void TryParse_BareArray_ReturnsNotes()
    {
        const string json = """[{"pitch":60,"start":0,"duration":0.5,"velocity":0.5},{"pitch":62,"start":0.5,"duration":0.5,"velocity":0.5}]""";

        var notes = AiNoteParser.TryParse(json, MaxNotes);

        Assert.Equal(2, notes!.Count);
    }

    [Fact]
    public void TryParse_CodeFencedJson_IsStripped()
    {
        const string fenced = "```json\n{\"notes\":[{\"pitch\":72,\"start\":0,\"duration\":1,\"velocity\":0.9}]}\n```";

        var notes = AiNoteParser.TryParse(fenced, MaxNotes);

        Assert.Equal(72, Assert.Single(notes!).Pitch);
    }

    [Fact]
    public void TryParse_JsonWrappedInProse_IsRecovered()
    {
        const string text = "Sure! Here is your melody: {\"notes\":[{\"pitch\":65,\"start\":0,\"duration\":2,\"velocity\":0.6}]} Enjoy.";

        var notes = AiNoteParser.TryParse(text, MaxNotes);

        Assert.Equal(65, Assert.Single(notes!).Pitch);
    }

    [Fact]
    public void TryParse_OutOfRangeValues_AreClamped()
    {
        // pitch above 127, negative start, zero duration, velocity above 1 — every field is
        // pulled back to the composer's valid range instead of being trusted.
        const string json = """{"notes":[{"pitch":999,"start":-4,"duration":0,"velocity":9}]}""";

        var note = Assert.Single(AiNoteParser.TryParse(json, MaxNotes)!);

        Assert.Equal(127, note.Pitch);
        Assert.Equal(0, note.Start);
        Assert.Equal(1.0 / 16, note.Duration, 5);
        Assert.Equal(1, note.Velocity);
    }

    [Fact]
    public void TryParse_NegativePitch_ClampsToZero()
    {
        const string json = """{"notes":[{"pitch":-10,"start":0,"duration":1,"velocity":0.5}]}""";

        Assert.Equal(0, Assert.Single(AiNoteParser.TryParse(json, MaxNotes)!).Pitch);
    }

    [Fact]
    public void TryParse_MegaArray_IsTruncatedToMaxNotes()
    {
        var big = "{\"notes\":[" +
            string.Join(",", Enumerable.Range(0, 5000).Select(_ => "{\"pitch\":60,\"start\":0,\"duration\":1,\"velocity\":0.5}")) +
            "]}";

        var notes = AiNoteParser.TryParse(big, maxNotes: 512);

        Assert.Equal(512, notes!.Count);
    }

    [Fact]
    public void TryParse_EmptyNotesArray_ReturnsEmptyNotUsable()
    {
        // Valid JSON with zero notes is an empty list (distinct from "no JSON at all"),
        // which the endpoint treats as an unusable generation (422).
        var notes = AiNoteParser.TryParse("""{"notes":[]}""", MaxNotes);

        Assert.NotNull(notes);
        Assert.Empty(notes);
    }

    [Theory]
    [InlineData("I'm sorry, I can't help with that.")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{\"foo\":123}")]
    public void TryParse_Unusable_ReturnsNull(string text)
    {
        Assert.Null(AiNoteParser.TryParse(text, MaxNotes));
    }

    [Fact]
    public void Clamp_NonFiniteValues_FallBackToDefaults()
    {
        var note = AiNoteParser.Clamp(double.NaN, double.PositiveInfinity, double.NegativeInfinity, double.NaN);

        Assert.Equal(60, note.Pitch);
        Assert.Equal(0, note.Start);
        Assert.Equal(1, note.Duration);
        Assert.Equal(0.8, note.Velocity, 3);
    }

    [Fact]
    public void Clamp_RoundsPitchToNearestInteger()
    {
        Assert.Equal(61, AiNoteParser.Clamp(60.6, 0, 1, 0.5).Pitch);
    }
}
