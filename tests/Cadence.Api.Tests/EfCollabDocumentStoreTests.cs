using Cadence.Api.Collaboration;
using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for <see cref="EfCollabDocumentStore"/> against a real (in-memory
/// SQLite) <see cref="CadenceDbContext"/>. These prove the store round-trips a
/// room's update log through the database and upserts a single owner-scoped row,
/// which is what lets a collaboration room survive all peers disconnecting.
/// </summary>
public sealed class EfCollabDocumentStoreTests : IDisposable
{
    private const string OwnerId = "owner-1";
    private const string ProjectId = "project-1";

    private readonly SqliteConnection _connection;
    private readonly ServiceProvider _provider;
    private readonly EfCollabDocumentStore _store;

    public EfCollabDocumentStoreTests()
    {
        // One open connection keeps the in-memory schema alive across the scopes the
        // store creates per operation, mirroring how the app resolves a scoped
        // DbContext from the singleton relay.
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var services = new ServiceCollection();
        services.AddDbContext<CadenceDbContext>(options => options.UseSqlite(_connection));
        _provider = services.BuildServiceProvider();

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        db.Database.EnsureCreated();

        // The document FK requires an owner + project to exist first.
        db.Users.Add(new ApplicationUser
        {
            Id = OwnerId,
            UserName = "owner",
            NormalizedUserName = "OWNER",
            Email = "owner@example.com",
            NormalizedEmail = "OWNER@EXAMPLE.COM",
        });
        db.Projects.Add(new ProjectEntity
        {
            Id = ProjectId,
            OwnerId = OwnerId,
            Name = "Persisted Song",
            SchemaVersion = 1,
            Data = "{}",
        });
        db.SaveChanges();

        _store = new EfCollabDocumentStore(_provider.GetRequiredService<IServiceScopeFactory>());
    }

    [Fact]
    public async Task LoadAsync_MissingDocument_ReturnsEmpty()
    {
        Assert.Empty(await _store.LoadAsync(OwnerId, ProjectId, default));
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsUpdates()
    {
        IReadOnlyList<byte[]> updates = [[0x01, 0x02], [0xAB], [0xFF, 0x00, 0x7F]];

        await _store.SaveAsync(OwnerId, ProjectId, updates, default);
        var loaded = await _store.LoadAsync(OwnerId, ProjectId, default);

        Assert.Equal(updates.Count, loaded.Count);
        for (var i = 0; i < updates.Count; i++)
        {
            Assert.Equal(updates[i], loaded[i]);
        }
    }

    [Fact]
    public async Task SaveAsync_UpsertsSingleRow_OnRepeatedSaves()
    {
        await _store.SaveAsync(OwnerId, ProjectId, [[0x01]], default);
        await _store.SaveAsync(OwnerId, ProjectId, [[0x01], [0x02]], default);

        var loaded = await _store.LoadAsync(OwnerId, ProjectId, default);
        Assert.Equal(2, loaded.Count);

        // The second save must overwrite the first, not insert a duplicate row.
        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        Assert.Equal(1, await db.CollaborationDocuments.CountAsync());
    }

    [Fact]
    public async Task SaveAsync_PersistsStateAndTimestamp()
    {
        var before = DateTimeOffset.UtcNow;
        await _store.SaveAsync(OwnerId, ProjectId, [[0xAB]], default);

        using var scope = _provider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        var row = await db.CollaborationDocuments.SingleAsync();

        Assert.Equal(OwnerId, row.OwnerId);
        Assert.Equal(ProjectId, row.ProjectId);
        Assert.NotEmpty(row.State);
        Assert.True(row.UpdatedAt >= before);
    }

    [Fact]
    public async Task Documents_AreOwnerScoped()
    {
        // A different owner's project id collision must not read the first's state.
        await _store.SaveAsync(OwnerId, ProjectId, [[0xAB]], default);

        Assert.Empty(await _store.LoadAsync("someone-else", ProjectId, default));
    }

    public void Dispose()
    {
        _provider.Dispose();
        _connection.Dispose();
    }
}
