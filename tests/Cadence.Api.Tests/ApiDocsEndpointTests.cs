using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace Cadence.Api.Tests;

/// <summary>
/// Smoke tests for the API reference surface: the OpenAPI document and the Scalar
/// reference UI. Now that the API is internet-facing, docs are gated by
/// <c>ApiDocs:Enabled</c>, defaulting to ON only in Development and OFF in every
/// other environment (the test host runs as the non-Development "Testing"
/// environment). Operators can force either state with the flag.
/// </summary>
public class ApiDocsEndpointTests
{
    [Fact]
    public async Task Non_development_default_hides_openapi_document_and_scalar_reference()
    {
        // The factory boots the non-Development "Testing" environment and applies no
        // ApiDocs override, so the environment-driven default (OFF) takes effect.
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();

        var openApi = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.NotFound, openApi.StatusCode);

        var scalar = await client.GetAsync("/scalar");
        Assert.Equal(HttpStatusCode.NotFound, scalar.StatusCode);
    }

    [Fact]
    public async Task Explicitly_enabled_serves_openapi_document_and_scalar_reference()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["ApiDocs:Enabled"] = "true" },
        };
        var client = factory.CreateClient();

        var openApi = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, openApi.StatusCode);
        Assert.Contains("/api/info", await openApi.Content.ReadAsStringAsync());

        // The Scalar reference UI renders at /scalar and reads /openapi/v1.json.
        var scalar = await client.GetAsync("/scalar");
        Assert.Equal(HttpStatusCode.OK, scalar.StatusCode);
    }

    [Fact]
    public async Task Explicitly_disabled_hides_openapi_document_and_scalar_reference()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["ApiDocs:Enabled"] = "false" },
        };
        var client = factory.CreateClient();

        var openApi = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.NotFound, openApi.StatusCode);

        var scalar = await client.GetAsync("/scalar");
        Assert.Equal(HttpStatusCode.NotFound, scalar.StatusCode);
    }
}

/// <summary>
/// Unit coverage for the configuration seam that drives the docs gating above. The
/// WebApplicationFactory harness can only boot the non-Development "Testing"
/// environment (real persistence and blob storage are skipped there), so the
/// Development-defaults-ON vs non-Development-defaults-OFF distinction — and the
/// explicit flag override in both directions — is asserted directly against the
/// resolver here, mirroring how the CORS origin resolver is unit-tested.
/// </summary>
public class CadenceApiDocsTests
{
    [Theory]
    [InlineData("Development", null, true)]     // dev default: on for developer experience
    [InlineData("Production", null, false)]     // non-dev default: off (contract not published)
    [InlineData("Staging", null, false)]        // non-dev default: off
    [InlineData("Testing", null, false)]        // non-dev default: off (the test host)
    [InlineData("Production", "true", true)]    // operator opt-in wins over the default
    [InlineData("Development", "false", false)] // operator opt-out wins over the default
    public void ResolveEnabled_prefers_flag_then_environment_default(
        string environmentName, string? flag, bool expected)
    {
        var settings = flag is null
            ? new Dictionary<string, string?>()
            : new Dictionary<string, string?> { ["ApiDocs:Enabled"] = flag };
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings)
            .Build();
        var environment = new StubHostEnvironment(environmentName);

        Assert.Equal(expected, CadenceApiDocs.ResolveEnabled(configuration, environment));
    }

    private sealed class StubHostEnvironment(string environmentName) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = environmentName;
        public string ApplicationName { get; set; } = "Cadence.Api.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
