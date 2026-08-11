using Microsoft.Data.Sqlite;

namespace Cadence.Api.Tests;

/// <summary>
/// Builds isolated, shared-cache, in-memory SQLite databases for the test
/// fixtures.
/// <para>
/// A bare <c>DataSource=:memory:</c> database is private to a single connection,
/// which forces every <see cref="Microsoft.EntityFrameworkCore.DbContext"/> to
/// reuse one <see cref="SqliteConnection"/> object. When two operations touch that
/// one connection at once — e.g. the background <c>AccountEmailDispatcher</c>'s DB
/// work overlapping a request thread — SQLite immediately raises
/// <c>SQLITE_BUSY</c> ("database is locked"), because a connection cannot wait on a
/// lock it already holds (its busy handler is never invoked). That is the #126
/// flake.
/// </para>
/// <para>
/// A uniquely-<em>named</em> shared-cache database instead lets many connections
/// attach to one schema. Overlapping operations now run on distinct connections, so
/// SQLite's busy handler <em>does</em> apply and Microsoft.Data.Sqlite transparently
/// retries <c>SQLITE_BUSY</c>/<c>SQLITE_LOCKED</c> up to the command timeout rather
/// than failing. A fresh <see cref="Guid"/> name per fixture keeps parallel xUnit
/// classes fully isolated.
/// </para>
/// </summary>
internal static class SqliteTestDatabase
{
    /// <summary>
    /// A connection string for a freshly-named, shared-cache, in-memory SQLite
    /// database (e.g. <c>Data Source=cadence-tests-…;Mode=Memory;Cache=Shared</c>).
    /// Each call returns a unique name, isolating the caller's database.
    /// </summary>
    public static string NewConnectionString() =>
        new SqliteConnectionStringBuilder
        {
            DataSource = $"cadence-tests-{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();

    /// <summary>
    /// Opens a "keep-alive" connection that holds the named in-memory database open
    /// for the caller's lifetime. A shared-cache in-memory database is destroyed the
    /// moment its last connection closes, so without this keeper the schema would
    /// vanish between the per-operation connections EF Core opens and closes. Dispose
    /// the returned connection to drop the database.
    /// </summary>
    public static SqliteConnection OpenKeepAlive(string connectionString)
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        return connection;
    }
}
