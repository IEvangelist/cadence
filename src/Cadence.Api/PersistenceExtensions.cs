using System.Diagnostics.CodeAnalysis;
using Cadence.Data;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Cadence.Api;

/// <summary>
/// Persistence wiring for the API. In every non-Testing environment the Aspire
/// Npgsql client integration binds <see cref="CadenceDbContext"/> to the
/// "cadencedb" resource (health checks, telemetry, resilient connections). In the
/// Testing environment the test host registers an in-memory SQLite context
/// itself, so this is a no-op there.
/// </summary>
public static class PersistenceExtensions
{
    /// <summary>Register the Cadence database for non-Testing environments.</summary>
    public static IHostApplicationBuilder AddCadencePersistence(this IHostApplicationBuilder builder)
    {
        if (builder.Environment.IsEnvironment("Testing"))
        {
            return builder;
        }

        builder.AddNpgsqlDbContext<CadenceDbContext>("cadencedb");
        return builder;
    }

    /// <summary>
    /// Apply EF Core migrations at startup. Called only outside the Testing
    /// environment; the API waits for Postgres to be healthy before starting, so
    /// a short retry loop only guards against brief startup races.
    /// </summary>
    [ExcludeFromCodeCoverage]
    public static async Task MigrateCadenceDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Cadence.Api.Migration");

        for (var attempt = 1; attempt <= 10; attempt++)
        {
            try
            {
                await db.Database.MigrateAsync();
                return;
            }
            catch (Exception ex) when (attempt < 10)
            {
                logger.LogWarning(ex, "Database migration attempt {Attempt} failed; retrying.", attempt);
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
    }
}
