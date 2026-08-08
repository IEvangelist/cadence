using Cadence.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>
/// A <see cref="WebApplicationFactory{TEntryPoint}"/> that boots the API in the
/// "Testing" environment (so the Aspire Npgsql component is skipped) and binds
/// <see cref="CadenceDbContext"/> to a single, shared, in-memory SQLite
/// connection. SQLite gives relational fidelity (constraints, unique indexes,
/// cascade deletes) without Docker; keeping one open connection for the factory's
/// lifetime keeps the schema alive across request scopes.
/// </summary>
public sealed class CadenceApiFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

    /// <summary>Captures magic-link tokens so tests can complete the flow.</summary>
    public CapturingMagicLinkSender MagicLinks { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        _connection.Open();

        builder.ConfigureServices(services =>
        {
            services.AddDbContext<CadenceDbContext>(options => options.UseSqlite(_connection));
            services.AddSingleton<IMagicLinkSender>(MagicLinks);

            using var provider = services.BuildServiceProvider();
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
            db.Database.EnsureCreated();
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _connection.Dispose();
        }
    }
}
