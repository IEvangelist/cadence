using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace Cadence.Api;

/// <summary>
/// Gating for the API reference surface — the OpenAPI document at
/// <c>/openapi/v1.json</c> and the Scalar reference UI at <c>/scalar</c>. Now that
/// the API is internet-facing (Aspire <c>WithExternalHttpEndpoints()</c>), the full
/// contract must not be published by default in production. The docs are therefore
/// enabled only when <c>ApiDocs:Enabled</c> resolves to <c>true</c>, defaulting to
/// ON in Development (for developer experience) and OFF in every other environment.
/// An operator can still force either state explicitly via the flag.
/// </summary>
public static class CadenceApiDocs
{
    /// <summary>
    /// Resolves whether the API reference endpoints should be mapped. Reads the
    /// <c>ApiDocs:Enabled</c> flag and, when it is absent, defaults to whether the
    /// host is running in the Development environment.
    /// </summary>
    public static bool ResolveEnabled(IConfiguration configuration, IHostEnvironment environment) =>
        configuration.GetValue("ApiDocs:Enabled", environment.IsDevelopment());
}
