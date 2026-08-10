namespace Cadence.Api.Collaboration;

/// <summary>
/// Serializes a room's ordered list of Yjs update payloads to a single opaque
/// blob and back. The blob is what a <see cref="ICollabDocumentStore"/> persists;
/// keeping the framing here (a length-prefixed concatenation) makes the storage
/// layer content-agnostic — it never needs to understand the y-protocol.
///
/// Each update is written as a lib0 <c>varUint</c> byte length followed by that
/// many payload bytes, so updates of any size round-trip losslessly and in order.
/// </summary>
public static class CollabDocumentCodec
{
    /// <summary>Concatenate <paramref name="updates"/> into a single length-prefixed blob.</summary>
    public static byte[] Encode(IReadOnlyList<byte[]> updates)
    {
        var buffer = new List<byte>();
        foreach (var update in updates)
        {
            YProtocol.WriteVarUint(buffer, (uint)update.Length);
            buffer.AddRange(update);
        }

        return buffer.ToArray();
    }

    /// <summary>
    /// Decode a blob produced by <see cref="Encode"/> back into its ordered update
    /// list. A null or empty blob yields an empty list. A blob that is truncated or
    /// otherwise malformed yields the updates decoded so far (fail soft: partial
    /// state is better than dropping the whole document), stopping at the bad frame.
    /// </summary>
    public static IReadOnlyList<byte[]> Decode(byte[]? blob)
    {
        var updates = new List<byte[]>();
        if (blob is null || blob.Length == 0)
        {
            return updates;
        }

        var span = blob.AsSpan();
        var offset = 0;
        while (offset < span.Length)
        {
            if (!YProtocol.TryReadVarUint(span, ref offset, out var length))
            {
                break; // malformed length prefix → stop
            }

            if (length > (uint)(span.Length - offset))
            {
                break; // truncated payload → stop
            }

            updates.Add(span.Slice(offset, (int)length).ToArray());
            offset += (int)length;
        }

        return updates;
    }
}
