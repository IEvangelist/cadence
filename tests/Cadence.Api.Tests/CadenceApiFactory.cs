using Cadence.Api.Billing;
using Cadence.Api.RateLimiting;
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
/// <see cref="CadenceDbContext"/> to a uniquely-named, shared-cache, in-memory
/// SQLite database. SQLite gives relational fidelity (constraints, unique indexes,
/// cascade deletes) without Docker.
/// <para>
/// The database is addressed by a connection <em>string</em> (not a shared
/// connection object), so EF Core opens its own connection per operation. A held-
/// open keep-alive connection keeps the shared-cache database — and its schema —
/// alive for the factory's lifetime. This lets the background email dispatcher and
/// the request thread each use their own connection instead of racing on one, which
/// is what fixes the intermittent "database is locked" (#126). A unique name per
/// factory instance isolates parallel xUnit classes from each other. See
/// <see cref="SqliteTestDatabase"/>.
/// </para>
/// </summary>
public sealed class CadenceApiFactory : WebApplicationFactory<Program>
{
    private readonly string _connectionString = SqliteTestDatabase.NewConnectionString();
    private readonly SqliteConnection _keepAlive;

    public CadenceApiFactory() => _keepAlive = SqliteTestDatabase.OpenKeepAlive(_connectionString);

    /// <summary>Captures account emails (magic-link, verification) so tests can drive the flow.</summary>
    public CapturingAccountEmailSender AccountEmails { get; } = new();

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

    /// <summary>
    /// Optional distributed rate-limit counter store. Supplying one (typically a
    /// single instance shared between two factories) makes the auth limiters use the
    /// Redis-style limiter path with a GLOBAL budget, so a test can prove the
    /// per-email cap is enforced across two independent API "replicas" (#75).
    /// </summary>
    public IRateLimitCounterStore? RateLimitCounterStore { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // Registration now defers sign-in, so the RegisterAsync test seed authenticates
        // through the (rate-limited) login endpoint. Under the in-process TestServer
        // every client shares the "unknown" client IP, so without generous defaults the
        // shared per-IP login/send budgets would aggregate across a class fixture's many
        // seeds and start returning 429. These high defaults keep seeding unthrottled;
        // the rate-limit tests set their own low limits via ConfigOverrides, which are
        // applied AFTER these and therefore win.
        builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["RateLimiting:Login:PermitLimit"] = "1000000",
            ["RateLimiting:MagicLinkSend:PermitLimit"] = "1000000",
            ["RateLimiting:MagicLinkSendEmail:PermitLimit"] = "1000000",
        }));

        if (ConfigOverrides is { Count: > 0 } overrides)
        {
            builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(overrides));
        }

        builder.ConfigureServices(services =>
        {
            services.AddDbContext<CadenceDbContext>(options => options.UseSqlite(_connectionString));
            services.AddSingleton<IAccountEmailSender>(AccountEmails);
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

            if (RateLimitCounterStore is { } counterStore)
            {
                services.RemoveAll<IRateLimitCounterStore>();
                services.AddSingleton(counterStore);
            }

            using var provider = services.BuildServiceProvider();
            using var scope = provider.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
            db.Database.EnsureCreated();
        });
    }

    /// <summary>
    /// Wait for the background account-email dispatcher to drain, so tests can
    /// deterministically assert on send side effects that the request path now
    /// performs asynchronously (magic-link send and registration emails).
    /// </summary>
    public Task WaitForEmailsAsync(TimeSpan? timeout = null) =>
        Services.GetRequiredService<AccountEmailDispatcher>()
            .WaitForIdleAsync(timeout ?? TimeSpan.FromSeconds(10));

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing)
        {
            _keepAlive.Dispose();
        }
    }
}
