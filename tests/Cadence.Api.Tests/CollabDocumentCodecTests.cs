using Cadence.Api.Collaboration;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for the length-prefixed codec that serializes a room's ordered Yjs
/// update log to the single blob a <see cref="ICollabDocumentStore"/> persists.
/// The codec must round-trip losslessly and fail soft on a corrupt blob so a bad
/// byte can never take down an entire project's collaboration state.
/// </summary>
public class CollabDocumentCodecTests
{
    [Fact]
    public void EncodeDecode_RoundTripsUpdatesInOrder()
    {
        byte[][] updates = [[0xAB], [0x01, 0x02, 0x03], [0xFF, 0x00, 0x7F, 0x80]];

        var blob = CollabDocumentCodec.Encode(updates);
        var decoded = CollabDocumentCodec.Decode(blob);

        Assert.Equal(updates.Length, decoded.Count);
        for (var i = 0; i < updates.Length; i++)
        {
            Assert.Equal(updates[i], decoded[i]);
        }
    }

    [Fact]
    public void Encode_EmptyList_ProducesEmptyBlob()
    {
        Assert.Empty(CollabDocumentCodec.Encode([]));
    }

    [Fact]
    public void Encode_PreservesEmptyUpdateEntries()
    {
        // A zero-length update must survive as a distinct entry (len 0 prefix), not
        // be silently coalesced away — order and count are load-bearing for replay.
        byte[][] updates = [[], [0xAB], []];

        var decoded = CollabDocumentCodec.Decode(CollabDocumentCodec.Encode(updates));

        Assert.Equal(3, decoded.Count);
        Assert.Empty(decoded[0]);
        Assert.Equal([0xAB], decoded[1]);
        Assert.Empty(decoded[2]);
    }

    [Fact]
    public void Decode_Null_ReturnsEmpty()
    {
        Assert.Empty(CollabDocumentCodec.Decode(null));
    }

    [Fact]
    public void Decode_Empty_ReturnsEmpty()
    {
        Assert.Empty(CollabDocumentCodec.Decode([]));
    }

    [Fact]
    public void Decode_TruncatedPayload_ReturnsUpdatesDecodedSoFar()
    {
        // First entry is well-formed (len 1, 0xAB); second declares len 4 but only
        // one byte follows → decoder keeps the good entry and stops at the bad one.
        byte[] blob = [0x01, 0xAB, 0x04, 0x99];

        var decoded = CollabDocumentCodec.Decode(blob);

        Assert.Single(decoded);
        Assert.Equal([0xAB], decoded[0]);
    }

    [Fact]
    public void Decode_TrailingLengthPrefixWithoutBody_StopsCleanly()
    {
        // A valid entry followed by a dangling length byte declaring more bytes than
        // remain → the good entry is returned, the dangling prefix is ignored.
        byte[] blob = [0x01, 0xAB, 0x07];

        var decoded = CollabDocumentCodec.Decode(blob);

        Assert.Single(decoded);
        Assert.Equal([0xAB], decoded[0]);
    }
}
