using Cadence.Api;
using Cadence.Data.Stems;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Cadence.Api.Tests;

/// <summary>Unit tests for the stem configuration options.</summary>
public class StemOptionsTests
{
    [Theory]
    [InlineData("audio/wav")]
    [InlineData("audio/mpeg")]
    [InlineData("AUDIO/WAV")]
    [InlineData("audio/wav; codecs=1")]
    public void IsContentTypeAllowed_AcceptsAllowedMediaTypes(string contentType) =>
        Assert.True(new StemOptions().IsContentTypeAllowed(contentType));

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/json")]
    [InlineData("image/png")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void IsContentTypeAllowed_RejectsEverythingElse(string? contentType) =>
        Assert.False(new StemOptions().IsContentTypeAllowed(contentType));

    [Fact]
    public void Defaults_AreSensible()
    {
        var options = new StemOptions();
        Assert.Equal(50L * 1024 * 1024, options.MaxUploadBytes);
        Assert.Equal(600, options.MaxDurationSeconds);
        Assert.Equal("stems", options.ContainerName);
        Assert.Null(options.ModelUri);
        Assert.Null(options.ModelSha256);
        Assert.Equal(300, options.ProcessingLeaseSeconds);
        Assert.Equal(3, options.MaxAttempts);
    }

    [Theory]
    [InlineData(nameof(StemOptions.MaxUploadBytes))]
    [InlineData(nameof(StemOptions.MaxDurationSeconds))]
    [InlineData(nameof(StemOptions.ProcessingLeaseSeconds))]
    [InlineData(nameof(StemOptions.MaxAttempts))]
    public void Validate_RejectsNonPositiveBounds(string propertyName)
    {
        var options = new StemOptions();
        var property = typeof(StemOptions).GetProperty(propertyName)!;
        property.SetValue(options, Convert.ChangeType(0, property.PropertyType));

        var result = new StemOptionsValidator(isProduction: false).Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(result.Failures, failure => failure.Contains(propertyName, StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_RejectsChecksumWithoutModelUri()
    {
        var options = new StemOptions { ModelSha256 = new string('a', 64) };

        var result = new StemOptionsValidator(isProduction: false).Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(result.Failures, failure => failure.Contains("requires Stems:ModelUri", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_RejectsInsecureRemoteModel()
    {
        var options = new StemOptions
        {
            ModelUri = "http://models.example.test/model.onnx",
            ModelSha256 = new string('a', 64),
        };

        var result = new StemOptionsValidator(isProduction: false).Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(result.Failures, failure => failure.Contains("must use https", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ProductionRemoteModelRequiresValidChecksum()
    {
        var missing = new StemOptions { ModelUri = "https://models.example.test/model.onnx" };
        var malformed = new StemOptions
        {
            ModelUri = "https://models.example.test/model.onnx",
            ModelSha256 = "not-a-digest",
        };
        var valid = new StemOptions
        {
            ModelUri = "https://models.example.test/model.onnx",
            ModelSha256 = $"sha256:{new string('a', 64)}",
        };
        var validator = new StemOptionsValidator(isProduction: true);

        Assert.True(validator.Validate(null, missing).Failed);
        Assert.True(validator.Validate(null, malformed).Failed);
        Assert.True(validator.Validate(null, valid).Succeeded);
    }

    [Fact]
    public void Validate_DevelopmentRemoteModelMayOmitChecksum()
    {
        var options = new StemOptions { ModelUri = "https://models.example.test/model.onnx" };

        Assert.True(new StemOptionsValidator(isProduction: false).Validate(null, options).Succeeded);
    }

    [Theory]
    [InlineData(" \thttps://models.example.test/model.onnx\r\n ")]
    [InlineData(" \tfile:///models/model.onnx\r\n ")]
    [InlineData(" \tC:\\models\\model.onnx\r\n ")]
    public void Validate_WhitespaceWrappedSecureAndLocalModels_Succeeds(string modelUri)
    {
        var options = new StemOptions
        {
            ModelUri = modelUri,
            ModelSha256 = new string('a', 64),
        };

        Assert.True(new StemOptionsValidator(isProduction: true).Validate(null, options).Succeeded);
    }

    [Fact]
    public async Task AddCadenceStems_InvalidBoundsFailHostStartup()
    {
        var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
        {
            EnvironmentName = "Testing",
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Stems:MaxUploadBytes"] = "0",
        });
        builder.AddCadenceStems();
        using var host = builder.Build();

        var exception = await Assert.ThrowsAsync<OptionsValidationException>(
            () => host.StartAsync());
        Assert.Contains(nameof(StemOptions.MaxUploadBytes), exception.Message, StringComparison.Ordinal);
    }
}
