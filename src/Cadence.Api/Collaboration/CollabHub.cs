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
///
/// For durability the hub also keeps each room's ordered log of Yjs update
/// payloads. The log is loaded (via a caller-supplied delegate) when a room's
/// first peer joins and saved when its last peer leaves, so a room survives all
/// peers disconnecting. The hub itself stays storage-agnostic — the delegate owns
/// the database — which keeps it unit-testable without a DbContext.
/// </summary>
public sealed class CollabHub
{
    private readonly ConcurrentDictionary<string, CollabRoom> _rooms = new();

    /// <summary>
    /// Register a connection in a room, loading the room's persisted update log the
    /// first time the room materializes so a reconnecting collaborator can be
    /// rehydrated from it (see <see cref="SnapshotUpdates"/>).
    /// </summary>
    public async Task<CollabConnection> JoinAsync(
        string room,
        WebSocket socket,
        CollaborationRole role,
        Func<Task<IReadOnlyList<byte[]>>> load,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            var candidate = _rooms.GetOrAdd(room, static _ => new CollabRoom());
            await candidate.Gate.WaitAsync(cancellationToken);

            // Guard against a concurrent LeaveAsync having pruned this exact room
            // between GetOrAdd and acquiring its gate; joining a detached room would
            // split-brain it from later joiners. Retry with a fresh room instead.
            if (!_rooms.TryGetValue(room, out var current) || !ReferenceEquals(current, candidate))
            {
                candidate.Gate.Release();
                continue;
            }

            try
            {
                if (!candidate.Loaded)
                {
                    var stored = await load();
                    lock (candidate.Sync)
                    {
                        candidate.Updates.AddRange(stored);
                    }

                    candidate.Loaded = true;
                }

                var connection = new CollabConnection(socket, role);
                candidate.Members[connection.Id] = connection;
                return connection;
            }
            finally
            {
                candidate.Gate.Release();
            }
        }
    }

    /// <summary>
    /// A point-in-time copy of a room's durable update log, used to answer a
    /// client's sync-step-1 state request. Empty when the room is unknown or has no
    /// persisted state yet.
    /// </summary>
    public IReadOnlyList<byte[]> SnapshotUpdates(string room)
    {
        if (!_rooms.TryGetValue(room, out var current))
        {
            return [];
        }

        lock (current.Sync)
        {
            return [.. current.Updates];
        }
    }

    /// <summary>Append a document update payload to the room's durable log.</summary>
    public void AppendUpdate(string room, byte[] update)
    {
        if (_rooms.TryGetValue(room, out var current))
        {
            lock (current.Sync)
            {
                current.Updates.Add(update);
            }
        }
    }

    /// <summary>
    /// Remove a connection; when it was the room's last member, persist the room's
    /// update log via <paramref name="save"/> and prune the room. Persistence runs
    /// to completion (it is never cancelled) so edits are not lost on an abrupt
    /// disconnect.
    /// </summary>
    public async Task LeaveAsync(string room, Guid connectionId, Func<IReadOnlyList<byte[]>, Task> save)
    {
        if (!_rooms.TryGetValue(room, out var current))
        {
            return;
        }

        await current.Gate.WaitAsync(CancellationToken.None);
        try
        {
            current.Members.TryRemove(connectionId, out _);
            if (!current.Members.IsEmpty)
            {
                return;
            }

            byte[][] snapshot;
            lock (current.Sync)
            {
                snapshot = [.. current.Updates];
            }

            if (snapshot.Length > 0)
            {
                await save(snapshot);
            }

            // Prune only if this is still the live room object for the key, so a
            // room a concurrent join swapped in is never removed out from under it.
            _rooms.TryRemove(new KeyValuePair<string, CollabRoom>(room, current));
        }
        finally
        {
            current.Gate.Release();
        }
    }

    /// <summary>Broadcast a frame to every other open connection in the room.</summary>
    public async Task BroadcastAsync(
        string room,
        Guid senderId,
        ReadOnlyMemory<byte> message,
        CancellationToken cancellationToken)
    {
        if (!_rooms.TryGetValue(room, out var current))
        {
            return;
        }

        foreach (var (id, member) in current.Members)
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
    public int Count(string room) => _rooms.TryGetValue(room, out var current) ? current.Members.Count : 0;

    /// <summary>
    /// A live room: its connected members plus the durable, ordered log of Yjs
    /// update payloads applied while collaborating.
    /// </summary>
    private sealed class CollabRoom
    {
        /// <summary>Serializes room lifecycle (load-once join, save-on-empty leave).</summary>
        public SemaphoreSlim Gate { get; } = new(1, 1);

        /// <summary>Guards <see cref="Updates"/> against concurrent append/snapshot.</summary>
        public object Sync { get; } = new();

        /// <summary>Open connections keyed by their stable id.</summary>
        public ConcurrentDictionary<Guid, CollabConnection> Members { get; } = new();

        /// <summary>Ordered log of update payloads (the durable document).</summary>
        public List<byte[]> Updates { get; } = [];

        /// <summary>Whether the persisted log has been loaded into <see cref="Updates"/>.</summary>
        public bool Loaded { get; set; }
    }
}
