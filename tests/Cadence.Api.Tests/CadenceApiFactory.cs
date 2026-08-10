using Cadence.Api.Billing;
using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Stems;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

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

    /// <summary>
    /// Optional override for the magic-link token lifespan, so a test can force a
    /// token to expire quickly and assert the expiry is enforced.
    /// </summary>
    public TimeSpan? MagicLinkTokenLifespan { get; init; }

    /// <summary>
    /// Extra in-memory configuration applied on top of the app's settings, so a
    /// test can tune billing/entitlement options (e.g. a small project cap) without
    /// touching the shared class-fixture factory.
    /// </summary>
    public IReadOnlyDictionary<string, string?>? ConfigOverrides { get; init; }

    /// <summary>
    /// Optional replacement for the Stripe billing gateway, so endpoint tests can
    /// return canned checkout/portal URLs and never call the live Stripe API.
    /// </summary>
    public IBillingGateway? BillingGateway { get; init; }

    /// <summary>
    /// In-memory stem storage substituted for the Azure Blob client in tests, so
    /// upload/download flows work without Azurite. Tests can inspect stored blobs.
    /// </summary>
    internal InMemoryStemStorage StemStorage { get; } = new();

    /// <summary>
    /// Optional replacement for password hashing, so auth hardening tests can
    /// assert verification paths without relying on wall-clock timing.
    /// </summary>
    public IPasswordHasher<ApplicationUser>? PasswordHasher { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        _connection.Open();

        if (ConfigOverrides is { Count: > 0 } overrides)
        {
            builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(overrides));
        }

        builder.ConfigureServices(services =>
        {
            services.AddDbContext<CadenceDbContext>(options => options.UseSqlite(_connection));
            services.AddSingleton<IMagicLinkSender>(MagicLinks);
            services.AddSingleton<IStemStorage>(StemStorage);

            if (MagicLinkTokenLifespan is { } lifespan)
            {
                services.Configure<MagicLinkTokenProviderOptions>(o => o.TokenLifespan = lifespan);
            }

            if (BillingGateway is { } gateway)
            {
                services.RemoveAll<IBillingGateway>();
                services.AddSingleton(gateway);
            }

            if (PasswordHasher is { } passwordHasher)
            {
                services.RemoveAll<IPasswordHasher<ApplicationUser>>();
                services.AddSingleton(passwordHasher);
            }

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
