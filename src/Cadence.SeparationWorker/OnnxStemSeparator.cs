using System.Diagnostics.CodeAnalysis;
using Cadence.Data.Stems;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Cadence.SeparationWorker;

/// <summary>
/// Production separation engine: runs a pinned Demucs (htdemucs) export through
/// ONNX Runtime. It prefers the CUDA execution provider when one is available and
/// falls back to CPU automatically, so the same build runs on a GPU box or a plain
/// CI/dev machine. Demucs isolates four sources (drums, bass, other, vocals); the
/// extended catalog labels (guitar, keys, synth) are sub-split from the residual
/// "other" stem with the deterministic band engine so every catalog label is
/// present. See <c>docs/stems.md</c> for the model pin, provenance, and license.
/// </summary>
/// <remarks>
/// This wraps native ONNX Runtime inference and needs a real model + audio, so it
/// is excluded from unit-coverage; the pipeline logic it feeds is covered by the
/// <see cref="SeparationJobProcessor"/> unit tests via the band-split seam, and the
/// end-to-end flow is covered by the Aspire integration tests (band-split engine).
/// </remarks>
[ExcludeFromCodeCoverage]
public sealed class OnnxStemSeparator(
    IStemModelProvider modelProvider,
    ILogger<OnnxStemSeparator> logger) : IStemSeparator, IAsyncDisposable
{
    // htdemucs emits four sources in this fixed channel order.
    private static readonly StemLabel[] ModelSources =
    [
        StemLabel.Drums,
        StemLabel.Bass,
        StemLabel.Other,
        StemLabel.Vocals,
    ];

    // Catalog labels the 4-source model does not isolate directly; derived from the
    // residual "other" source so the full catalog is always produced.
    private static readonly StemLabel[] DerivedFromOther =
    [
        StemLabel.Guitar,
        StemLabel.Keys,
        StemLabel.Synth,
    ];

    private const int ModelChannels = 2;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private InferenceSession? _session;

    /// <inheritdoc />
    public async Task<IReadOnlyList<SeparatedStem>> SeparateAsync(
        Stream mix,
        string contentType,
        CancellationToken cancellationToken = default)
    {
        var audio = await WavAudio.DecodeAsync(mix, cancellationToken);
        var session = await GetSessionAsync(cancellationToken);

        var input = BuildInput(audio);
        var inputName = session.InputMetadata.Keys.First();

        using var results = session.Run([NamedOnnxValue.CreateFromTensor(inputName, input)]);
        var output = results.First().AsTensor<float>();

        return MapToCatalog(output, audio.SampleRate);
    }

    private static DenseTensor<float> BuildInput(PcmAudio audio)
    {
        var frames = audio.FrameCount;
        var input = new DenseTensor<float>([1, ModelChannels, frames]);
        for (var f = 0; f < frames; f++)
        {
            for (var c = 0; c < ModelChannels; c++)
            {
                var sourceChannel = c < audio.Channels ? c : 0;
                input[0, c, f] = audio.Samples[(f * audio.Channels) + sourceChannel];
            }
        }

        return input;
    }

    private static List<SeparatedStem> MapToCatalog(Tensor<float> output, int sampleRate)
    {
        // Expected shape: [batch=1, sources=4, channels, frames].
        var dims = output.Dimensions;
        if (dims.Length != 4 || dims[1] != ModelSources.Length)
        {
            throw new InvalidOperationException(
                $"Unexpected model output rank/shape [{string.Join(',', dims.ToArray())}]; " +
                $"expected [1,{ModelSources.Length},channels,frames].");
        }

        var channels = dims[2];
        var frames = dims[3];
        var byLabel = new Dictionary<StemLabel, byte[]>(StemCatalog.All.Count);
        PcmAudio? otherAudio = null;

        for (var s = 0; s < ModelSources.Length; s++)
        {
            var interleaved = new float[frames * channels];
            for (var f = 0; f < frames; f++)
            {
                for (var c = 0; c < channels; c++)
                {
                    interleaved[(f * channels) + c] = output[0, s, c, f];
                }
            }

            var pcm = new PcmAudio(sampleRate, channels, interleaved);
            byLabel[ModelSources[s]] = WavAudio.Encode(pcm);
            if (ModelSources[s] == StemLabel.Other)
            {
                otherAudio = pcm;
            }
        }

        // Sub-split the residual into the extended labels so the catalog is complete.
        var residual = BandSplitStemSeparator.Separate(otherAudio!);
        foreach (var label in DerivedFromOther)
        {
            byLabel[label] = residual.First(stem => stem.Label == label).Wav;
        }

        return StemCatalog.All
            .Select(label => new SeparatedStem(label, byLabel[label]))
            .ToList();
    }

    private async Task<InferenceSession> GetSessionAsync(CancellationToken cancellationToken)
    {
        if (_session is not null)
        {
            return _session;
        }

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_session is null)
            {
                var modelPath = await modelProvider.GetModelPathAsync(cancellationToken);
                _session = CreateSession(modelPath);
            }

            return _session;
        }
        finally
        {
            _gate.Release();
        }
    }

    private InferenceSession CreateSession(string modelPath)
    {
        var options = new SessionOptions();
        try
        {
            // GPU-optional: register CUDA when its native provider is present.
            options.AppendExecutionProvider_CUDA(0);
            logger.LogInformation("Stem separation using the CUDA execution provider.");
        }
        catch (Exception ex)
        {
            // The base ONNX Runtime package is CPU-only; without the GPU provider
            // this throws and we transparently fall back to CPU.
            logger.LogWarning(ex, "CUDA execution provider unavailable; using CPU.");
        }

        return new InferenceSession(modelPath, options);
    }

    public ValueTask DisposeAsync()
    {
        _session?.Dispose();
        _gate.Dispose();
        return ValueTask.CompletedTask;
    }
}
