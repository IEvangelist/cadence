using System.Net.WebSockets;
using Cadence.Api.Collaboration;
using Cadence.Data.Entities;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for <see cref="CollabHub"/>'s durability lifecycle: it loads a room's
/// persisted update log once when the room materializes, accumulates writes while
/// peers collaborate, and saves the log when the last peer leaves so the room can
/// survive everyone disconnecting. The store is a pair of delegates here, so the
/// hub is exercised without a database.
/// </summary>
public class CollabHubPersistenceTests
{
    [Fact]
    public async Task JoinAsync_LoadsPersistedLogOnce_PerRoom()
    {
        var hub = new CollabHub();
        var loadCount = 0;
        IReadOnlyList<byte[]> stored = [[0x01], [0x02]];

        Task<IReadOnlyList<byte[]>> Load()
        {
            Interlocked.Increment(ref loadCount);
            return Task.FromResult(stored);
        }

        var first = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, Load, default);
        var second = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, Load, default);

        Assert.Equal(1, loadCount); // loaded only on the first join
        Assert.Equal(2, hub.Count("room"));
        Assert.NotEqual(first.Id, second.Id);

        // The loaded log is what a reconnecting peer's sync request would receive.
        var snapshot = hub.SnapshotUpdates("room");
        Assert.Equal(2, snapshot.Count);
        Assert.Equal([0x01], snapshot[0]);
        Assert.Equal([0x02], snapshot[1]);
    }

    [Fact]
    public async Task AppendUpdate_AccumulatesAfterTheLoadedLog()
    {
        var hub = new CollabHub();
        await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, () => Task.FromResult<IReadOnlyList<byte[]>>([[0x01]]), default);

        hub.AppendUpdate("room", [0x02]);
        hub.AppendUpdate("room", [0x03]);

        var snapshot = hub.SnapshotUpdates("room");
        Assert.Equal(3, snapshot.Count);
        Assert.Equal([0x01], snapshot[0]);
        Assert.Equal([0x02], snapshot[1]);
        Assert.Equal([0x03], snapshot[2]);
    }

    [Fact]
    public async Task SnapshotUpdates_IsACopy_NotTheLiveList()
    {
        var hub = new CollabHub();
        await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, () => Task.FromResult<IReadOnlyList<byte[]>>([]), default);

        var before = hub.SnapshotUpdates("room");
        hub.AppendUpdate("room", [0xAB]);

        Assert.Empty(before); // the earlier snapshot is unaffected by the later append
        Assert.Single(hub.SnapshotUpdates("room"));
    }

    [Fact]
    public void SnapshotUpdates_UnknownRoom_IsEmpty()
    {
        Assert.Empty(new CollabHub().SnapshotUpdates("nope"));
    }

    [Fact]
    public async Task LeaveAsync_PersistsLog_WhenLastPeerLeaves()
    {
        var hub = new CollabHub();
        IReadOnlyList<byte[]>? saved = null;

        var a = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, () => Task.FromResult<IReadOnlyList<byte[]>>([]), default);
        var b = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, () => Task.FromResult<IReadOnlyList<byte[]>>([]), default);
        hub.AppendUpdate("room", [0xAB]);

        await hub.LeaveAsync("room", a.Id, updates => { saved = updates; return Task.CompletedTask; });
        Assert.Null(saved); // still one peer in the room → nothing persisted yet
        Assert.Equal(1, hub.Count("room"));

        await hub.LeaveAsync("room", b.Id, updates => { saved = updates; return Task.CompletedTask; });

        Assert.NotNull(saved);
        Assert.Single(saved!);
        Assert.Equal([0xAB], saved![0]);
        Assert.Equal(0, hub.Count("room")); // room pruned
    }

    [Fact]
    public async Task LeaveAsync_DoesNotPersist_WhenLogIsEmpty()
    {
        var hub = new CollabHub();
        var saveCount = 0;

        var a = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, () => Task.FromResult<IReadOnlyList<byte[]>>([]), default);
        await hub.LeaveAsync("room", a.Id, _ => { saveCount++; return Task.CompletedTask; });

        Assert.Equal(0, saveCount); // nothing was ever written → no empty row persisted
        Assert.Equal(0, hub.Count("room"));
    }

    [Fact]
    public async Task LeaveAsync_UnknownRoom_IsNoOp()
    {
        var hub = new CollabHub();
        var saveCount = 0;

        await hub.LeaveAsync("ghost", Guid.NewGuid(), _ => { saveCount++; return Task.CompletedTask; });

        Assert.Equal(0, saveCount);
    }

    [Fact]
    public async Task Rejoin_AfterAllLeft_ReloadsFromStore()
    {
        var hub = new CollabHub();
        var loadCount = 0;
        var persisted = new List<byte[]>();

        Task<IReadOnlyList<byte[]>> Load()
        {
            Interlocked.Increment(ref loadCount);
            return Task.FromResult<IReadOnlyList<byte[]>>([.. persisted]);
        }

        // First session: one editor writes an update, then leaves → log persisted.
        var first = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, Load, default);
        hub.AppendUpdate("room", [0xAB]);
        await hub.LeaveAsync("room", first.Id, updates => { persisted = [.. updates]; return Task.CompletedTask; });

        // Room was pruned, so the next join must reload from the store, not memory.
        var second = await hub.JoinAsync("room", new FakeWebSocket(), CollaborationRole.Editor, Load, default);

        Assert.Equal(2, loadCount); // reloaded on the fresh room
        _ = second;
        var snapshot = hub.SnapshotUpdates("room");
        Assert.Single(snapshot);
        Assert.Equal([0xAB], snapshot[0]);
    }
}

/// <summary>
/// A minimal in-process <see cref="WebSocket"/> test double: it reports an open
/// socket and records outbound frames, which is all <see cref="CollabHub"/> needs
/// to register a connection and (optionally) broadcast in a unit test.
/// </summary>
internal sealed class FakeWebSocket : WebSocket
{
    private WebSocketState _state = WebSocketState.Open;

    public List<byte[]> Sent { get; } = [];

    public override WebSocketState State => _state;

    public override WebSocketCloseStatus? CloseStatus => null;

    public override string? CloseStatusDescription => null;

    public override string? SubProtocol => null;

    public override void Abort() => _state = WebSocketState.Aborted;

    public override void Dispose() => _state = WebSocketState.Closed;

    public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
    {
        _state = WebSocketState.Closed;
        return Task.CompletedTask;
    }

    public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
    {
        _state = WebSocketState.CloseSent;
        return Task.CompletedTask;
    }

    public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken cancellationToken) =>
        throw new NotSupportedException();

    public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken cancellationToken)
    {
        Sent.Add([.. buffer]);
        return Task.CompletedTask;
    }
}
