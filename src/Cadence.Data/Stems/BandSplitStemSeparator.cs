namespace Cadence.Data.Stems;

/// <summary>
/// The deterministic, dependency-free reference separation engine. It performs a
/// linear-phase-free spectral band split: each dedicated stem is the mix passed
/// through a distinct biquad filter, and <see cref="StemLabel.Other"/> is the
/// residual (mix minus the dedicated bands), so the stems sum back toward the
/// original.
/// </summary>
/// <remarks>
/// This is intentionally NOT a neural source separator — it is the honest,
/// offline fallback that lets the whole pipeline (upload → job → stems → download)
/// run in development and CI without a model or a GPU, and it is the seam tests use
/// in place of the real engine. The production <c>OnnxStemSeparator</c> (Demucs via
/// ONNX Runtime) implements the same <see cref="IStemSeparator"/> seam and is
/// selected when a model is configured. See <c>docs/stems.md</c>.
/// </remarks>
public sealed class BandSplitStemSeparator : IStemSeparator
{
    private enum FilterKind
    {
        LowPass,
        BandPass,
        HighPass,
    }

    private readonly record struct Band(StemLabel Label, FilterKind Kind, double Frequency, double Q);

    // One filter per dedicated stem, spread across the spectrum. "Other" is the
    // residual and so is not listed here.
    private static readonly Band[] Bands =
    [
        new(StemLabel.Bass, FilterKind.LowPass, 120, 0.707),
        new(StemLabel.Drums, FilterKind.BandPass, 180, 0.8),
        new(StemLabel.Keys, FilterKind.BandPass, 500, 1.0),
        new(StemLabel.Vocals, FilterKind.BandPass, 1200, 1.2),
        new(StemLabel.Guitar, FilterKind.BandPass, 2500, 1.2),
        new(StemLabel.Synth, FilterKind.HighPass, 6000, 0.707),
    ];

    /// <inheritdoc />
    public async Task<IReadOnlyList<SeparatedStem>> SeparateAsync(
        Stream mix,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        var audio = await WavAudio.DecodeAsync(mix, cancellationToken);
        return Separate(audio);
    }

    /// <summary>Separate already-decoded audio into the full catalog of stems.</summary>
    public static IReadOnlyList<SeparatedStem> Separate(PcmAudio audio)
    {
        var byLabel = new Dictionary<StemLabel, float[]>(StemCatalog.All.Count);
        var residual = (float[])audio.Samples.Clone();

        foreach (var band in Bands)
        {
            var filtered = ApplyPerChannel(audio, band);
            byLabel[band.Label] = filtered;
            for (var i = 0; i < residual.Length; i++)
            {
                residual[i] -= filtered[i];
            }
        }

        byLabel[StemLabel.Other] = residual;

        return StemCatalog.All
            .Select(label => new SeparatedStem(
                label,
                WavAudio.Encode(new PcmAudio(audio.SampleRate, audio.Channels, byLabel[label]))))
            .ToList();
    }

    private static float[] ApplyPerChannel(PcmAudio audio, Band band)
    {
        var output = new float[audio.Samples.Length];
        var channels = Math.Max(1, audio.Channels);
        var nyquist = audio.SampleRate / 2.0;
        var frequency = Math.Clamp(band.Frequency, 10, nyquist * 0.9);
        var c = CreateCoefficients(band.Kind, frequency, band.Q, audio.SampleRate);

        for (var channel = 0; channel < channels; channel++)
        {
            double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
            for (var i = channel; i < audio.Samples.Length; i += channels)
            {
                double x0 = audio.Samples[i];
                var y0 = (c.B0 * x0) + (c.B1 * x1) + (c.B2 * x2) - (c.A1 * y1) - (c.A2 * y2);
                x2 = x1;
                x1 = x0;
                y2 = y1;
                y1 = y0;
                output[i] = (float)y0;
            }
        }

        return output;
    }

    // Normalized RBJ "audio EQ cookbook" biquad coefficients (a0 folded in).
    private readonly record struct Coefficients(double B0, double B1, double B2, double A1, double A2);

    private static Coefficients CreateCoefficients(FilterKind kind, double frequency, double q, int sampleRate)
    {
        var w0 = 2.0 * Math.PI * frequency / sampleRate;
        var cos = Math.Cos(w0);
        var sin = Math.Sin(w0);
        var alpha = sin / (2.0 * Math.Max(q, 1e-4));

        double b0, b1, b2;
        var a0 = 1.0 + alpha;
        var a1 = -2.0 * cos;
        var a2 = 1.0 - alpha;

        switch (kind)
        {
            case FilterKind.LowPass:
                b0 = (1.0 - cos) / 2.0;
                b1 = 1.0 - cos;
                b2 = (1.0 - cos) / 2.0;
                break;
            case FilterKind.HighPass:
                b0 = (1.0 + cos) / 2.0;
                b1 = -(1.0 + cos);
                b2 = (1.0 + cos) / 2.0;
                break;
            default: // BandPass (constant 0 dB peak gain)
                b0 = alpha;
                b1 = 0.0;
                b2 = -alpha;
                break;
        }

        return new Coefficients(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }
}
