using Cadence.Data.Stems;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Cadence.Api;

/// <summary>
/// Registers the stem-separation services on the API. <see cref="StemOptions"/> is
/// bound in every environment; the Azure Blob client and its
/// <see cref="BlobStemStorage"/> are wired only outside the Testing environment,
/// where the test host substitutes an in-memory <see cref="IStemStorage"/> — the
/// same split <see cref="PersistenceExtensions"/> uses for the database.
/// </summary>
public static class CadenceStemsExtensions
{
    /// <summary>Register stem options and (outside Testing) Blob-backed storage.</summary>
    public static IHostApplicationBuilder AddCadenceStems(this IHostApplicationBuilder builder)
    {
        // Bind lazily via IOptions so late-added configuration (e.g. test overrides)
        // is honored, then expose the resolved value for direct injection.
        builder.Services.Configure<StemOptions>(builder.Configuration.GetSection(StemOptions.SectionName));
        builder.Services.AddSingleton(sp => sp.GetRequiredService<IOptions<StemOptions>>().Value);

        if (!builder.Environment.IsEnvironment("Testing"))
        {
            // Aspire Blob client integration binds to the "blobs" resource (Azurite
            // in development), with health checks, telemetry, and resilience.
            builder.AddAzureBlobServiceClient("blobs");
            builder.Services.AddSingleton<IStemStorage, BlobStemStorage>();
        }

        return builder;
    }
}
