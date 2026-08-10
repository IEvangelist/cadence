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
    /// The canonical encoding of an empty Yjs document update (<c>[0, 0]</c>: zero
    /// client structs, empty delete set). Applying it is a no-op, so the relay can
    /// answer a state request for a fresh room with a valid empty sync step-2 —
    /// which flips the client to "synced" and lets it seed the new document.
    /// </summary>
    public static readonly byte[] EmptyDocumentUpdate = [0x00, 0x00];

    /// <summary>
    /// True when <paramref name="message"/> is a sync <see cref="SyncStep1"/> — a
    /// read-only state-vector request. The relay answers these from its durable
    /// update log so a reconnecting collaborator converges from the server.
    /// </summary>
    public static bool IsSyncStep1(ReadOnlySpan<byte> message)
    {
        var offset = 0;
        if (!TryReadVarUint(message, ref offset, out var messageType) || messageType != MessageSync)
        {
            return false;
        }

        return TryReadVarUint(message, ref offset, out var syncType) && syncType == SyncStep1;
    }

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

    /// <summary>
    /// Append <paramref name="value"/> to <paramref name="buffer"/> as an unsigned
    /// LEB128 <c>varUint</c> — the inverse of <see cref="TryReadVarUint"/>.
    /// </summary>
    public static void WriteVarUint(List<byte> buffer, uint value)
    {
        while (value >= 0x80)
        {
            buffer.Add((byte)(value | 0x80));
            value >>= 7;
        }

        buffer.Add((byte)value);
    }

    /// <summary>
    /// Build a <see cref="SyncStep2"/> frame carrying <paramref name="update"/> as
    /// its <c>varUint8Array</c> payload. y-websocket flips a client to "synced"
    /// when it processes a step-2, so the relay sends the persisted document as a
    /// step-2 to rehydrate a lone reconnecting collaborator (see
    /// <c>CollaborationEndpoints</c>).
    /// </summary>
    public static byte[] BuildSyncStep2(ReadOnlySpan<byte> update) => BuildSyncFrame(SyncStep2, update);

    /// <summary>
    /// Build a <see cref="SyncUpdate"/> frame carrying <paramref name="update"/> as
    /// its <c>varUint8Array</c> payload. Used to replay the remaining persisted
    /// updates after the initial step-2 during rehydration.
    /// </summary>
    public static byte[] BuildSyncUpdate(ReadOnlySpan<byte> update) => BuildSyncFrame(SyncUpdate, update);

    /// <summary>
    /// Extract the raw Yjs update payload from a sync <em>write</em> frame
    /// (<see cref="SyncStep2"/> or <see cref="SyncUpdate"/>). Returns false for
    /// awareness, the read-only <see cref="SyncStep1"/>, or any malformed/truncated
    /// frame — so only genuine document mutations are appended to the durable log.
    /// </summary>
    public static bool TryReadUpdatePayload(ReadOnlySpan<byte> message, out byte[] payload)
    {
        payload = [];
        var offset = 0;
        if (!TryReadVarUint(message, ref offset, out var messageType) || messageType != MessageSync)
        {
            return false;
        }

        if (!TryReadVarUint(message, ref offset, out var syncType) || syncType is not (SyncStep2 or SyncUpdate))
        {
            return false;
        }

        if (!TryReadVarUint(message, ref offset, out var length))
        {
            return false;
        }

        // Guard against a length that overruns the frame (avoids overflow too).
        if (length > (uint)(message.Length - offset))
        {
            return false;
        }

        payload = message.Slice(offset, (int)length).ToArray();
        return true;
    }

    private static byte[] BuildSyncFrame(uint syncType, ReadOnlySpan<byte> update)
    {
        var buffer = new List<byte>(update.Length + 6);
        WriteVarUint(buffer, MessageSync);
        WriteVarUint(buffer, syncType);
        WriteVarUint(buffer, (uint)update.Length);
        foreach (var b in update)
        {
            buffer.Add(b);
        }

        return buffer.ToArray();
    }
}
