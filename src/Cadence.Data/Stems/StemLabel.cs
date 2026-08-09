namespace Cadence.Data.Stems;

/// <summary>
/// The canonical set of stems Cadence isolates from a mix. The order here is the
/// catalog order surfaced to clients (see <see cref="StemCatalog"/>). Persisted by
/// name (not ordinal) so reordering the enum never corrupts stored rows.
/// </summary>
public enum StemLabel
{
    /// <summary>Bass guitar / low-frequency instruments.</summary>
    Bass = 0,

    /// <summary>Drum kit and percussion.</summary>
    Drums = 1,

    /// <summary>Lead and backing vocals.</summary>
    Vocals = 2,

    /// <summary>Guitars (electric and acoustic).</summary>
    Guitar = 3,

    /// <summary>Keyboards and piano.</summary>
    Keys = 4,

    /// <summary>Synthesizers and pads.</summary>
    Synth = 5,

    /// <summary>Everything not captured by a dedicated stem.</summary>
    Other = 6,
}
