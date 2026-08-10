using System.Collections.Concurrent;
using System.Net.WebSockets;
using Cadence.Data.Entities;

namespace Cadence.Api.Collaboration;

/// <summary>
/// In-memory registry of live collaboration connections grouped into per-project
/// rooms. The relay is a pure broadcaster: it forwards each peer's frames to the
/// other peers in the same room, which is sufficient for Yjs peers to converge
/// (they exchange state vectors and updates directly). Role enforcement happens
/// before broadcast — see the receive loop's write gate.
/// </summary>
public sealed class CollabHub
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, CollabConnection>> _rooms = new();

    /// <summary>Register a connection in a room; returns the tracked handle.</summary>
    public CollabConnection Join(string room, WebSocket socket, CollaborationRole role)
    {
        var connection = new CollabConnection(socket, role);
        var members = _rooms.GetOrAdd(room, static _ => new ConcurrentDictionary<Guid, CollabConnection>());
        members[connection.Id] = connection;
        return connection;
    }

    /// <summary>Remove a connection; prunes the room when it becomes empty.</summary>
    public void Leave(string room, Guid connectionId)
    {
        if (_rooms.TryGetValue(room, out var members))
        {
            members.TryRemove(connectionId, out _);
            if (members.IsEmpty)
            {
                _rooms.TryRemove(room, out _);
            }
        }
    }

    /// <summary>Broadcast a frame to every other open connection in the room.</summary>
    public async Task BroadcastAsync(
        string room,
        Guid senderId,
        ReadOnlyMemory<byte> message,
        CancellationToken cancellationToken)
    {
        if (!_rooms.TryGetValue(room, out var members))
        {
            return;
        }

        foreach (var (id, member) in members)
        {
            if (id == senderId || member.Socket.State != WebSocketState.Open)
            {
                continue;
            }

            try
            {
                await member.SendAsync(message, cancellationToken);
            }
            catch (WebSocketException)
            {
                // A peer dropped mid-broadcast; its receive loop will clean it up.
            }
        }
    }

    /// <summary>Number of active connections in a room (used by tests).</summary>
    public int Count(string room) => _rooms.TryGetValue(room, out var members) ? members.Count : 0;
}
