using Cadence.Data.Stems;

namespace Cadence.Api.Tests;

/// <summary>Unit tests for the minimal 16-bit PCM WAV codec.</summary>
public class WavAudioTests
{
    [Fact]
    public void EncodeThenDecode_RoundTripsMetadataAndSamples()
    {
        float[] samples = [0f, 0.5f, -0.5f, 0.25f, -0.25f, 0.999f, -0.999f, 0.1f];
        var audio = new PcmAudio(48000, 2, samples);

        var decoded = WavAudio.Decode(WavAudio.Encode(audio));

        Assert.Equal(48000, decoded.SampleRate);
        Assert.Equal(2, decoded.Channels);
        Assert.Equal(4, decoded.FrameCount);
        Assert.Equal(samples.Length, decoded.Samples.Length);
        for (var i = 0; i < samples.Length; i++)
        {
            // 16-bit quantization error is at most 1 LSB (~3.1e-5).
            Assert.True(Math.Abs(samples[i] - decoded.Samples[i]) < 1e-4, $"sample {i}");
        }
    }

    [Fact]
    public void Encode_ClampsOutOfRangeSamples()
    {
        var audio = new PcmAudio(8000, 1, [2f, -2f]);

        var decoded = WavAudio.Decode(WavAudio.Encode(audio));

        Assert.True(decoded.Samples[0] > 0.99f);
        Assert.True(decoded.Samples[1] < -0.99f);
    }

    [Fact]
    public async Task DecodeAsync_MatchesSyncDecode()
    {
        var wav = StemAudioFixtures.CreateMixWav(frames: 256);

        using var stream = new MemoryStream(wav);
        var fromStream = await WavAudio.DecodeAsync(stream);
        var fromBytes = WavAudio.Decode(wav);

        Assert.Equal(fromBytes.SampleRate, fromStream.SampleRate);
        Assert.Equal(fromBytes.Samples.Length, fromStream.Samples.Length);
    }

    [Theory]
    [InlineData(new byte[] { 1, 2, 3 })]
    [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x4E, 0x4F, 0x50, 0x45 })]
    public void Decode_Throws_OnNonRiffWave(byte[] bytes) =>
        Assert.Throws<FormatException>(() => WavAudio.Decode(bytes));

    [Fact]
    public void FrameCount_IsZero_ForZeroChannels() =>
        Assert.Equal(0, new PcmAudio(44100, 0, []).FrameCount);
}
