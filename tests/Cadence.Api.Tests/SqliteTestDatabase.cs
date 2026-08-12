using System.Collections.Concurrent;
using Microsoft.Data.Sqlite;

namespace Cadence.Api.Tests;

/// <summary>
/// A dedicated, on-disk SQLite database for a single test fixture. Each instance
/// owns a uniquely-named temp file (e.g. <c>…\cadence-tests-{Guid}.db</c>) and
/// deletes it — with any journal/WAL sidecars — when disposed.
/// <para>
/// <b>Why a temp file and not shared-cache in-memory.</b> The earlier fix for #126
/// gave each fixture a uniquely-named <c>Mode=Memory;Cache=Shared</c> database so
/// that overlapping work — the background <c>AccountEmailDispatcher</c> and a request
/// thread — ran on <em>distinct</em> connections over one shared schema, letting
/// SQLite's busy handler and Microsoft.Data.Sqlite's retry rescue the transient
/// <c>SQLITE_BUSY</c> "database is locked" lock waits. That removed the single-
/// connection contention, but it left a second, subtler race (#132): under
/// <c>Cache=Shared</c> every connection reaches into the <em>same</em> in-memory
/// database, and EF Core registers/removes its user-defined functions on <em>each</em>
/// new connection during <c>InitializeDbConnection</c>. <c>sqlite3_create_function</c>
/// (and its removal) returns <c>SQLITE_BUSY</c> when <em>another</em> connection on
/// that shared-cache database is holding an active statement — and, unlike a lock
/// wait, that failure is <em>not</em> rescued by <c>busy_timeout</c>/retry, because
/// it is blocked by active statements rather than a lock the busy handler can spin
/// on. That surfaced as the intermittent
/// <c>MagicLinkTests.VerifyMagicLink_WithBadToken_RedirectsToError</c> failure
/// (<c>SqliteConnection.CreateFunctionCore</c> ← <c>InitializeDbConnection</c>).
/// </para>
/// <para>
/// A per-fixture <em>file</em> database removes that hazard: connections no longer
/// share one cache, so each opens and initializes (including registering its user
/// functions) independently, and cross-connection <em>lock</em> contention is still
/// covered by SQLite's busy handler plus Microsoft.Data.Sqlite's retry. A unique
/// file name per fixture keeps parallel xUnit classes fully isolated, exactly as the
/// shared-cache name did.
/// </para>
/// <para>
/// Pooling is disabled so that closing a connection immediately releases the OS file
/// handle, which lets <see cref="Dispose"/> delete the database file reliably on
/// Windows.
/// </para>
/// </summary>
internal sealed class SqliteTestDatabase : IDisposable
{
    // Every database file this process creates, so the process-exit sweep can remove
    // any whose per-fixture Dispose lost a race with a still-closing connection (e.g.
    // the background AccountEmailDispatcher draining while the factory is torn down).
    private static readonly ConcurrentDictionary<string, byte> ActiveDataSources = new();

    static SqliteTestDatabase() =>
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            foreach (var dataSource in ActiveDataSources.Keys)
            {
                DeleteWithSidecars(dataSource);
            }
        };

    private readonly string _dataSource;

    public SqliteTestDatabase()
    {
        _dataSource = Path.Combine(Path.GetTempPath(), $"cadence-tests-{Guid.NewGuid():N}.db");
        ActiveDataSources[_dataSource] = 0;
        ConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _dataSource,
            // Release the file handle the moment a connection closes so the file can
            // be deleted on dispose; each operation still opens its own connection.
            Pooling = false,
        }.ToString();
    }

    /// <summary>
    /// The connection <em>string</em> for this fixture's database. Bind EF Core to
    /// the string (not a shared connection object) so every operation and
    /// BackgroundService opens its own connection over the one on-disk schema.
    /// </summary>
    public string ConnectionString { get; }

    /// <summary>
    /// Deletes the database file and any <c>-journal</c>/<c>-wal</c>/<c>-shm</c>
    /// sidecars. Best-effort: if a connection is still closing (so the file is briefly
    /// locked) the delete is retried, and anything still held is left to the
    /// process-exit sweep rather than failing the test run.
    /// </summary>
    public void Dispose() => DeleteWithSidecars(_dataSource);

    private static void DeleteWithSidecars(string dataSource)
    {
        // The path stays tracked for the process-exit sweep even after a successful
        // delete: a connection still closing during teardown can reopen the string one
        // last time, which makes SQLite recreate an empty file the sweep must reclaim.
        TryDelete(dataSource);
        TryDelete($"{dataSource}-journal");
        TryDelete($"{dataSource}-wal");
        TryDelete($"{dataSource}-shm");
    }

    private static void TryDelete(string path)
    {
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                // File.Delete is a no-op (no throw) when the path does not exist.
                File.Delete(path);
                return;
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }

            Thread.Sleep(50);
        }
    }
}
