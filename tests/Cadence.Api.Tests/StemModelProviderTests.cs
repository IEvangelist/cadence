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
            ModelUri = " \thttps://models.example.test/htdemucs.onnx\r\n ",
            ModelSha256 = StemModelIntegrity.ComputeSha256Hex(model),
        };
        Assert.True(new StemOptionsValidator(isProduction: true).Validate(null, options).Succeeded);
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
            Assert.All(handler.RequestUris, uri =>
                Assert.Equal("https://models.example.test/htdemucs.onnx", uri.AbsoluteUri));
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

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GetModelPathAsync_WhitespaceWrappedLocalReference_AgreesWithStartupValidation(
        bool useFileUri)
    {
        var model = "operator managed model"u8.ToArray();
        var directory = Path.Combine(
            AppContext.BaseDirectory,
            $"stem-local-model-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        var modelPath = Path.Combine(directory, "model.onnx");
        await File.WriteAllBytesAsync(modelPath, model);
        var configuredReference = useFileUri ? new Uri(modelPath).AbsoluteUri : modelPath;
        var options = new StemOptions
        {
            ModelUri = $" \t{configuredReference}\r\n ",
            ModelSha256 = StemModelIntegrity.ComputeSha256Hex(model),
        };
        var handler = new ModelHandler(model);
        using var httpClient = new HttpClient(handler);

        try
        {
            Assert.True(new StemOptionsValidator(isProduction: true).Validate(null, options).Succeeded);
            var provider = new HttpStemModelProvider(
                httpClient,
                options,
                NullLogger<HttpStemModelProvider>.Instance,
                Path.Combine(directory, "cache"));

            var resolvedPath = await provider.GetModelPathAsync();

            Assert.Equal(modelPath, resolvedPath);
            Assert.Equal(0, handler.RequestCount);
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private sealed class ModelHandler(byte[] model) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        public List<Uri> RequestUris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            RequestUris.Add(request.RequestUri!);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(model),
            });
        }
    }
}
