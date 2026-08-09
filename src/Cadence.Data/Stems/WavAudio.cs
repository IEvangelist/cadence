using System.Buffers.Binary;
using System.Text;

namespace Cadence.Data.Stems;

/// <summary>Decoded PCM audio: interleaved samples normalized to <c>[-1, 1]</c>.</summary>
/// <param name="SampleRate">Samples per second per channel.</param>
/// <param name="Channels">Interleaved channel count (1 = mono, 2 = stereo).</param>
/// <param name="Samples">Interleaved samples (length = <see cref="Channels"/> * frames).</param>
public sealed record PcmAudio(int SampleRate, int Channels, float[] Samples)
{
    /// <summary>Number of frames (samples per channel).</summary>
    public int FrameCount => Channels == 0 ? 0 : Samples.Length / Channels;
}

/// <summary>
/// A tiny, dependency-free PCM/16-bit WAV (RIFF) reader and writer. It is
/// deliberately minimal — just enough to round-trip the mixes and stems the
/// reference <see cref="BandSplitStemSeparator"/> works with — and is fully
/// unit-tested. Production ONNX inference decodes compressed formats separately.
/// </summary>
public static class WavAudio
{
    private const int PcmFormat = 1;

    /// <summary>Decode a 16-bit PCM WAV byte stream into <see cref="PcmAudio"/>.</summary>
    /// <exception cref="FormatException">The bytes are not a supported 16-bit PCM WAV.</exception>
    public static PcmAudio Decode(ReadOnlySpan<byte> wav)
    {
        if (wav.Length < 12 ||
            !wav[..4].SequenceEqual("RIFF"u8) ||
            !wav.Slice(8, 4).SequenceEqual("WAVE"u8))
        {
            throw new FormatException("Not a RIFF/WAVE stream.");
        }

        int channels = 0, sampleRate = 0, bitsPerSample = 0;
        ReadOnlySpan<byte> data = default;
        var hasFmt = false;

        var pos = 12;
        while (pos + 8 <= wav.Length)
        {
            var chunkId = wav.Slice(pos, 4);
            var chunkSize = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(pos + 4, 4));
            var body = pos + 8;
            if (chunkSize < 0 || (long)body + chunkSize > wav.Length)
            {
                // Tolerate a chunk whose declared size overruns the buffer. The cast
                // to long keeps a huge declared size from overflowing the comparison.
                chunkSize = wav.Length - body;
            }

            if (chunkId.SequenceEqual("fmt "u8) && body + 16 <= wav.Length)
            {
                var format = BinaryPrimitives.ReadInt16LittleEndian(wav.Slice(body, 2));
                channels = BinaryPrimitives.ReadInt16LittleEndian(wav.Slice(body + 2, 2));
                sampleRate = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(body + 4, 4));
                bitsPerSample = BinaryPrimitives.ReadInt16LittleEndian(wav.Slice(body + 14, 2));
                hasFmt = true;
                if (format != PcmFormat)
                {
                    throw new FormatException($"Unsupported WAV format {format}; only 16-bit PCM is supported.");
                }
            }
            else if (chunkId.SequenceEqual("data"u8))
            {
                data = wav.Slice(body, chunkSize);
            }

            // Chunks are word-aligned: an odd size is padded with one byte. Advance
            // the cursor in long so a huge declared size can't overflow it, and stop
            // if the next chunk would start past the buffer rather than walking off
            // the end (which would slice a negative or out-of-range offset).
            long next = (long)body + chunkSize + (chunkSize & 1);
            if (next <= pos || next > wav.Length)
            {
                break;
            }

            pos = (int)next;
        }

        if (!hasFmt || channels <= 0 || sampleRate <= 0)
        {
            throw new FormatException("Missing or invalid fmt chunk.");
        }

        if (bitsPerSample != 16)
        {
            throw new FormatException($"Unsupported bit depth {bitsPerSample}; only 16-bit PCM is supported.");
        }

        var frameSamples = data.Length / 2;
        var samples = new float[frameSamples];
        for (var i = 0; i < frameSamples; i++)
        {
            var s = BinaryPrimitives.ReadInt16LittleEndian(data.Slice(i * 2, 2));
            samples[i] = s / 32768f;
        }

        return new PcmAudio(sampleRate, channels, samples);
    }

    /// <summary>Decode a stream fully, then decode its bytes as 16-bit PCM WAV.</summary>
    public static async Task<PcmAudio> DecodeAsync(Stream stream, CancellationToken cancellationToken = default)
    {
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        return Decode(buffer.GetBuffer().AsSpan(0, (int)buffer.Length));
    }

    /// <summary>
    /// Cheaply estimate a 16-bit PCM WAV's duration from its header chunks without
    /// decoding any samples. Returns <see langword="false"/> for anything that is not
    /// a parseable PCM WAV, so callers can fall back to the raw size cap.
    /// </summary>
    public static bool TryGetDurationSeconds(ReadOnlySpan<byte> wav, out double seconds)
    {
        seconds = 0;
        if (wav.Length < 12 ||
            !wav[..4].SequenceEqual("RIFF"u8) ||
            !wav.Slice(8, 4).SequenceEqual("WAVE"u8))
        {
            return false;
        }

        int channels = 0, sampleRate = 0, bitsPerSample = 0;
        long dataBytes = -1;
        var pos = 12;
        while (pos + 8 <= wav.Length)
        {
            var chunkId = wav.Slice(pos, 4);
            var chunkSize = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(pos + 4, 4));
            var body = pos + 8;
            if (chunkSize < 0)
            {
                return false;
            }

            if (chunkId.SequenceEqual("fmt "u8) && body + 16 <= wav.Length)
            {
                channels = BinaryPrimitives.ReadInt16LittleEndian(wav.Slice(body + 2, 2));
                sampleRate = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(body + 4, 4));
                bitsPerSample = BinaryPrimitives.ReadInt16LittleEndian(wav.Slice(body + 14, 2));
            }
            else if (chunkId.SequenceEqual("data"u8))
            {
                // The declared size may overrun a truncated buffer; clamp to reality.
                dataBytes = Math.Min(chunkSize, wav.Length - body);
            }

            // Advance the cursor in long so a huge declared size can't overflow it
            // and send the scan slicing a negative or out-of-range offset; treat an
            // overrunning chunk as end-of-stream.
            long next = (long)body + chunkSize + (chunkSize & 1);
            if (next <= pos || next > wav.Length)
            {
                break;
            }

            pos = (int)next;
        }

        if (channels <= 0 || sampleRate <= 0 || bitsPerSample <= 0 || dataBytes < 0)
        {
            return false;
        }

        var byteRate = (long)sampleRate * channels * (bitsPerSample / 8);
        if (byteRate <= 0)
        {
            return false;
        }

        seconds = dataBytes / (double)byteRate;
        return true;
    }

    /// <summary>Encode <see cref="PcmAudio"/> as a 16-bit PCM WAV byte array.</summary>
    public static byte[] Encode(PcmAudio audio)
    {
        var dataBytes = audio.Samples.Length * 2;
        var byteRate = audio.SampleRate * audio.Channels * 2;
        var blockAlign = (short)(audio.Channels * 2);

        using var stream = new MemoryStream(44 + dataBytes);
        using var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true);

        writer.Write("RIFF"u8);
        writer.Write(36 + dataBytes);
        writer.Write("WAVE"u8);

        writer.Write("fmt "u8);
        writer.Write(16);                       // PCM fmt chunk size
        writer.Write((short)PcmFormat);
        writer.Write((short)audio.Channels);
        writer.Write(audio.SampleRate);
        writer.Write(byteRate);
        writer.Write(blockAlign);
        writer.Write((short)16);                // bits per sample

        writer.Write("data"u8);
        writer.Write(dataBytes);
        foreach (var sample in audio.Samples)
        {
            var clamped = Math.Clamp(sample, -1f, 1f);
            writer.Write((short)Math.Round(clamped * 32767f));
        }

        writer.Flush();
        return stream.ToArray();
    }
}
