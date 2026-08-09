using System.Net;

namespace Cadence.Api.Tests;

/// <summary>
/// Smoke tests for the API reference surface: the OpenAPI document and the Scalar
/// reference UI. Cadence APIs ship with Scalar enabled in every environment, gated
/// by the <c>ApiDocs:Enabled</c> flag (default <c>true</c>) so operators can turn
/// it off — for example in production.
/// </summary>
public class ApiDocsEndpointTests
{
    [Fact]
    public async Task Enabled_by_default_serves_openapi_document_and_scalar_reference()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();

        var openApi = await client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, openApi.StatusCode);
        Assert.Contains("/api/info", await openApi.Content.ReadAsStringAsync());

        // The Scalar reference UI renders at /scalar and reads /openapi/v1.json.
        var scalar = await client.GetAsync("/scalar");
        Assert.Equal(HttpStatusCode.OK, scalar.StatusCode);
    }

    [Fact]
    public async Task Disabled_hides_openapi_document_and_scalar_reference()
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
