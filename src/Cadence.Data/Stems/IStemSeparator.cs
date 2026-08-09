namespace Cadence.Data.Stems;

/// <summary>One separated stem produced by an <see cref="IStemSeparator"/>.</summary>
/// <param name="Label">Which source this stem isolates.</param>
/// <param name="Wav">The stem audio, encoded as a 16-bit PCM WAV.</param>
public sealed record SeparatedStem(StemLabel Label, byte[] Wav);

/// <summary>
/// The pluggable separation engine seam. The pipeline depends only on this
/// interface, so the production ONNX/Demucs engine and the deterministic
/// <see cref="BandSplitStemSeparator"/> reference engine are fully interchangeable
/// — and tests can drop in a fake without a model or a GPU.
/// </summary>
public interface IStemSeparator
{
    /// <summary>
    /// Separate a mix into the full <see cref="StemCatalog"/> of labeled stems.
    /// Implementations return one <see cref="SeparatedStem"/> per catalog label.
    /// </summary>
    /// <param name="mix">The mixed audio to separate.</param>
    /// <param name="contentType">The mix's content type (engine hint).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    Task<IReadOnlyList<SeparatedStem>> SeparateAsync(
        Stream mix,
        string contentType,
        CancellationToken cancellationToken = default);
}
