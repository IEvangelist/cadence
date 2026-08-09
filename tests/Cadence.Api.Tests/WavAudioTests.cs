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

    [Fact]
    public void TryGetDurationSeconds_ReturnsExactLength_ForValidWav()
    {
        // 8000 Hz mono, 8000 frames -> exactly one second.
        var wav = StemAudioFixtures.CreateMixWav(sampleRate: 8000, channels: 1, frames: 8000);

        Assert.True(WavAudio.TryGetDurationSeconds(wav, out var seconds));
        Assert.Equal(1d, seconds, precision: 3);
    }

    // RIFF/WAVE streams that present as WAV but cannot be parsed. The first is the
    // reviewer's repro: a chunk whose declared size (0x7FFFFFFF) would overflow the
    // int chunk cursor and make the scan slice a negative offset.
    public static TheoryData<byte[]> MalformedWavs()
    {
        byte[] overflowingChunk = [.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8, .. "JUNK"u8, 0xFF, 0xFF, 0xFF, 0x7F];
        byte[] truncatedFmt = [.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8, .. "fmt "u8, 0x10, 0, 0, 0];
        byte[] noFmtChunk = [.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8, .. "data"u8, 0x10, 0, 0, 0, 1, 2, 3, 4];
        return new TheoryData<byte[]> { overflowingChunk, truncatedFmt, noFmtChunk };
    }

    [Theory]
    [MemberData(nameof(MalformedWavs))]
    public void TryGetDurationSeconds_ReturnsFalse_WithoutThrowing_OnMalformedWav(byte[] wav)
    {
        // The documented contract is "return false, never throw" for unparseable input.
        var parsed = WavAudio.TryGetDurationSeconds(wav, out var seconds);

        Assert.False(parsed);
        Assert.Equal(0d, seconds);
    }

    [Theory]
    [MemberData(nameof(MalformedWavs))]
    public void Decode_Throws_FormatException_OnMalformedWav(byte[] wav) =>
        // A malformed WAV must surface as a FormatException, never leak an
        // ArgumentOutOfRangeException from an overflowed cursor.
        Assert.Throws<FormatException>(() => WavAudio.Decode(wav));
}
