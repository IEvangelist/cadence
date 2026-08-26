using System.Net.WebSockets;
using Cadence.Api.Collaboration;
using Cadence.Data.Entities;

namespace Cadence.Api.Tests;

public class CollabRevocationBusTests
{
    private static readonly Func<Task<IReadOnlyList<byte[]>>> EmptyLoad =
        () => Task.FromResult<IReadOnlyList<byte[]>>([]);

    [Fact]
    public async Task Shared_bus_closes_matching_grants_on_every_replica_only()
    {
        var bus = new InMemoryCollabRevocationBus();
        var firstHub = new CollabHub(bus);
        var secondHub = new CollabHub(bus);
        var grant = bus.GrantId("shared-grant");
        var unrelated = bus.GrantId("unrelated-grant");
        var firstSocket = new FakeWebSocket();
        var secondSocket = new FakeWebSocket();
        var unrelatedSocket = new FakeWebSocket();

        await JoinAsync(firstHub, "room", firstSocket, "user-a", grant);
        await JoinAsync(secondHub, "room", secondSocket, "user-b", grant);
        await JoinAsync(secondHub, "other-room", unrelatedSocket, "user-c", unrelated);

        var revoked = await firstHub.RevokeGrantAsync(
            grant,
            () => Task.FromResult(true));

        Assert.True(revoked);
        Assert.Equal(WebSocketState.CloseSent, firstSocket.State);
        Assert.Equal(WebSocketState.CloseSent, secondSocket.State);
        Assert.Equal(WebSocketState.Open, unrelatedSocket.State);
    }

    [Fact]
    public async Task Join_paused_inside_grant_barrier_cannot_survive_revoke()
    {
        var bus = new InMemoryCollabRevocationBus();
        var hub = new CollabHub(bus);
        var grant = bus.GrantId("paused-grant");
        var socket = new FakeWebSocket();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var joining = hub.WithConnectionBarrierAsync(
            "joining-user",
            grant,
            async () =>
            {
                entered.SetResult();
                await release.Task;
                return await hub.JoinAsync(
                    "room",
                    socket,
                    CollaborationRole.Editor,
                    "joining-user",
                    "owner",
                    "project",
                    grant,
                    EmptyLoad,
                    default);
            });
        await entered.Task;
        var revoking = hub.RevokeGrantAsync(grant, () => Task.FromResult(true));
        Assert.False(revoking.IsCompleted);

        release.SetResult();
        var connection = await joining;
        Assert.True(await revoking);

        Assert.True(connection.IsRevoked);
        Assert.Equal(WebSocketState.CloseSent, socket.State);
    }

    [Fact]
    public async Task Revoke_waits_for_accepted_frame_and_blocks_every_later_frame()
    {
        var bus = new InMemoryCollabRevocationBus();
        var hub = new CollabHub(bus);
        var grant = bus.GrantId("frame-grant");
        var connection = await JoinAsync(
            hub,
            "room",
            new FakeWebSocket(),
            "frame-user",
            grant);
        var accepted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var frame = hub.ProcessFrameAsync(
            connection,
            async () =>
            {
                accepted.SetResult();
                await release.Task;
                hub.AppendUpdate("room", [0x01]);
            });
        await accepted.Task;
        var revoke = hub.RevokeGrantAsync(grant, () => Task.FromResult(true));
        Assert.False(revoke.IsCompleted);

        release.SetResult();
        Assert.True(await frame);
        Assert.True(await revoke);
        Assert.Single(hub.SnapshotUpdates("room"));

        var later = await hub.ProcessFrameAsync(
            connection,
            () =>
            {
                hub.AppendUpdate("room", [0x02]);
                return Task.CompletedTask;
            });
        Assert.False(later);
        Assert.Single(hub.SnapshotUpdates("room"));
    }

    private static Task<CollabConnection> JoinAsync(
        CollabHub hub,
        string room,
        WebSocket socket,
        string callerId,
        string grantId) =>
        hub.WithConnectionBarrierAsync(
            callerId,
            grantId,
            () => hub.JoinAsync(
                room,
                socket,
                CollaborationRole.Editor,
                callerId,
                "owner",
                "project",
                grantId,
                EmptyLoad,
                default));
}
