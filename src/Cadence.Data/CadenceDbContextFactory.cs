using System.Diagnostics.CodeAnalysis;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Cadence.Data;

/// <summary>
/// Design-time factory used only by the EF Core tooling (<c>dotnet ef</c>) to
/// build the model when adding or scripting migrations. It targets the Npgsql
/// provider so migrations are generated for the production database. A real
/// connection is never opened at design time, so a placeholder string is fine.
/// </summary>
[ExcludeFromCodeCoverage]
public sealed class CadenceDbContextFactory : IDesignTimeDbContextFactory<CadenceDbContext>
{
    /// <inheritdoc />
    public CadenceDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("CADENCE_DESIGN_CONNECTION")
            ?? "Host=localhost;Port=5432;Database=cadencedb;Username=postgres;Password=postgres";

        var options = new DbContextOptionsBuilder<CadenceDbContext>()
            .UseNpgsql(connectionString, npgsql => npgsql.MigrationsAssembly(typeof(CadenceDbContext).Assembly.FullName))
            .Options;

        return new CadenceDbContext(options);
    }
}
