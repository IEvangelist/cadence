using Cadence.Data.Stems;

namespace Cadence.Api.Tests;

/// <summary>Unit tests for the deterministic band-split reference separator.</summary>
public class BandSplitStemSeparatorTests
{
    [Fact]
    public async Task SeparateAsync_ProducesTheFullCatalog_InOrder()
    {
        var wav = StemAudioFixtures.CreateMixWav();
        using var stream = new MemoryStream(wav);

        var stems = await new BandSplitStemSeparator().SeparateAsync(stream, "audio/wav");

        Assert.Equal(StemCatalog.All, stems.Select(s => s.Label).ToArray());
    }

    [Fact]
    public void Separate_EachStem_IsValidWav_WithMatchingShape()
    {
        var audio = WavAudio.Decode(StemAudioFixtures.CreateMixWav());

        var stems = BandSplitStemSeparator.Separate(audio);

        foreach (var stem in stems)
        {
            var decoded = WavAudio.Decode(stem.Wav);
            Assert.Equal(audio.SampleRate, decoded.SampleRate);
            Assert.Equal(audio.Channels, decoded.Channels);
            Assert.Equal(audio.FrameCount, decoded.FrameCount);
        }
    }

    [Fact]
    public void Separate_IsDeterministic()
    {
        var audio = WavAudio.Decode(StemAudioFixtures.CreateMixWav());

        var first = BandSplitStemSeparator.Separate(audio);
        var second = BandSplitStemSeparator.Separate(audio);

        for (var i = 0; i < first.Count; i++)
        {
            Assert.Equal(first[i].Label, second[i].Label);
            Assert.Equal(first[i].Wav, second[i].Wav);
        }
    }

    [Fact]
    public void Separate_DedicatedBandsPlusResidual_ApproximateTheMix()
    {
        // The six band stems plus the "other" residual should reconstruct the mix:
        // by construction Other = mix - sum(bands), so summing all seven ~= mix.
        var audio = WavAudio.Decode(StemAudioFixtures.CreateMixWav(frames: 2048));

        var stems = BandSplitStemSeparator.Separate(audio)
            .Select(s => WavAudio.Decode(s.Wav).Samples)
            .ToList();

        var maxError = 0.0;
        for (var i = 0; i < audio.Samples.Length; i++)
        {
            var sum = stems.Sum(s => s[i]);
            maxError = Math.Max(maxError, Math.Abs(audio.Samples[i] - sum));
        }

        // Only 16-bit quantization across seven stems separates the sum from the mix.
        Assert.True(maxError < 1e-3, $"reconstruction error {maxError} too large");
    }
}
