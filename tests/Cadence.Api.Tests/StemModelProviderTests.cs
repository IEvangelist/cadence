extern alias StemWorker;

using System.Net;
using Cadence.Data.Stems;
using Microsoft.Extensions.Logging.Abstractions;
using HttpStemModelProvider = StemWorker::Cadence.SeparationWorker.HttpStemModelProvider;

namespace Cadence.Api.Tests;

public class StemModelProviderTests
{
    [Fact]
    public async Task GetModelPathAsync_PoisonedCache_IsPurgedAndRedownloaded()
    {
        var model = "valid pinned model"u8.ToArray();
        var handler = new ModelHandler(model);
        using var httpClient = new HttpClient(handler);
        var options = new StemOptions
        {
            ModelUri = "https://models.example.test/htdemucs.onnx",
            ModelSha256 = StemModelIntegrity.ComputeSha256Hex(model),
        };
        var cacheDirectory = Path.Combine(
            AppContext.BaseDirectory,
            $"stem-model-cache-{Guid.NewGuid():N}");

        try
        {
            var firstProvider = new HttpStemModelProvider(
                httpClient,
                options,
                NullLogger<HttpStemModelProvider>.Instance,
                cacheDirectory);
            var cachePath = await firstProvider.GetModelPathAsync();
            Assert.Equal(1, handler.RequestCount);

            await File.WriteAllBytesAsync(cachePath, "poisoned cache entry"u8.ToArray());

            var restartedProvider = new HttpStemModelProvider(
                httpClient,
                options,
                NullLogger<HttpStemModelProvider>.Instance,
                cacheDirectory);
            var repairedPath = await restartedProvider.GetModelPathAsync();

            Assert.Equal(cachePath, repairedPath);
            Assert.Equal(2, handler.RequestCount);
            Assert.Equal(model, await File.ReadAllBytesAsync(repairedPath));
        }
        finally
        {
            if (Directory.Exists(cacheDirectory))
            {
                Directory.Delete(cacheDirectory, recursive: true);
            }
        }
    }

    private sealed class ModelHandler(byte[] model) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(model),
            });
        }
    }
}
