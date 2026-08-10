namespace Cadence.Api.Collaboration;

/// <summary>
/// Minimal decoder for the y-protocol wire format used by y-websocket. Messages
/// are lib0 <c>varUint</c>-prefixed: an outer message type, and — for sync
/// messages — a sync sub-type. The relay only needs to tell <em>write</em>
/// frames (which mutate the shared document) from read/awareness frames, so the
/// role gate can drop the former from viewers server-side.
/// </summary>
public static class YProtocol
{
    /// <summary>Document synchronization message.</summary>
    public const uint MessageSync = 0;

    /// <summary>Awareness (presence) message.</summary>
    public const uint MessageAwareness = 1;

    /// <summary>Sync step 1: a state-vector request (read-only).</summary>
    public const uint SyncStep1 = 0;

    /// <summary>Sync step 2: a document diff (a write).</summary>
    public const uint SyncStep2 = 1;

    /// <summary>Incremental update (a write).</summary>
    public const uint SyncUpdate = 2;

    /// <summary>
    /// True when <paramref name="message"/> would mutate the shared document —
    /// i.e. a sync <see cref="SyncStep2"/> or <see cref="SyncUpdate"/> frame.
    /// Awareness, auth, query, and the read-only <see cref="SyncStep1"/> return
    /// false. A malformed/undecodable frame is treated as a write and rejected
    /// (fail closed) for viewers.
    /// </summary>
    public static bool IsWriteMessage(ReadOnlySpan<byte> message)
    {
        var offset = 0;
        if (!TryReadVarUint(message, ref offset, out var messageType))
        {
            return true; // undecodable → fail closed
        }

        if (messageType != MessageSync)
        {
            return false; // awareness/auth/query are never document writes
        }

        if (!TryReadVarUint(message, ref offset, out var syncType))
        {
            return true; // truncated sync header → fail closed
        }

        return syncType is SyncStep2 or SyncUpdate;
    }

    /// <summary>
    /// Read an unsigned LEB128 <c>varUint</c> at <paramref name="offset"/>,
    /// advancing it. Returns false on truncation or overflow.
    /// </summary>
    public static bool TryReadVarUint(ReadOnlySpan<byte> data, ref int offset, out uint value)
    {
        value = 0;
        var shift = 0;
        while (offset < data.Length)
        {
            var current = data[offset++];
            value |= (uint)(current & 0x7F) << shift;
            if ((current & 0x80) == 0)
            {
                return true;
            }

            shift += 7;
            if (shift > 28)
            {
                return false; // more than 32 bits → malformed
            }
        }

        return false;
    }
}
