using Cadence.Data.Stems;

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
}
