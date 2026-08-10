using Cadence.Api.Collaboration;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for the y-protocol write detector that backs the relay's viewer
/// gate. The classification decides whether a frame may mutate the shared
/// document, so it must fail closed on anything it cannot decode.
/// </summary>
public class YProtocolTests
{
    [Fact]
    public void SyncStep1_IsNotAWrite()
    {
        // sync(0) + syncStep1(0): a state-vector request is read-only.
        Assert.False(YProtocol.IsWriteMessage([0x00, 0x00]));
    }

    [Fact]
    public void SyncStep2_IsAWrite()
    {
        // sync(0) + syncStep2(1): a document diff mutates the doc.
        Assert.True(YProtocol.IsWriteMessage([0x00, 0x01]));
    }

    [Fact]
    public void SyncUpdate_IsAWrite()
    {
        // sync(0) + update(2): an incremental update mutates the doc.
        Assert.True(YProtocol.IsWriteMessage([0x00, 0x02, 0x00]));
    }

    [Fact]
    public void Awareness_IsNotAWrite()
    {
        Assert.False(YProtocol.IsWriteMessage([0x01, 0x00]));
    }

    [Fact]
    public void QueryAwareness_IsNotAWrite()
    {
        Assert.False(YProtocol.IsWriteMessage([0x03]));
    }

    [Fact]
    public void EmptyFrame_FailsClosed()
    {
        Assert.True(YProtocol.IsWriteMessage([]));
    }

    [Fact]
    public void TruncatedSyncHeader_FailsClosed()
    {
        // sync(0) with no sub-type byte → undecodable → treated as a write.
        Assert.True(YProtocol.IsWriteMessage([0x00]));
    }

    [Fact]
    public void MultiByteVarUint_IsDecoded()
    {
        // A message type encoded as a 2-byte varUint (300 = 0xAC 0x02); not sync,
        // so not a write.
        Assert.False(YProtocol.IsWriteMessage([0xAC, 0x02]));
    }

    [Fact]
    public void OverlongVarUint_FailsClosed()
    {
        // Five continuation bytes exceed 32 bits → malformed → fail closed.
        Assert.True(YProtocol.IsWriteMessage([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]));
    }

    [Fact]
    public void IsSyncStep1_TrueForStateVectorRequest()
    {
        // sync(0) + syncStep1(0): the read-only request the relay answers from its log.
        Assert.True(YProtocol.IsSyncStep1([0x00, 0x00]));
    }

    [Theory]
    [InlineData(new byte[] { 0x00, 0x01 })] // sync + step2
    [InlineData(new byte[] { 0x00, 0x02 })] // sync + update
    [InlineData(new byte[] { 0x01, 0x00 })] // awareness
    [InlineData(new byte[] { 0x00 })]       // truncated sync header
    [InlineData(new byte[] { })]            // empty
    public void IsSyncStep1_FalseForEverythingElse(byte[] message)
    {
        Assert.False(YProtocol.IsSyncStep1(message));
    }

    [Fact]
    public void EmptyDocumentUpdate_IsTheCanonicalEmptyUpdate()
    {
        // [0,0] = zero client structs + empty delete set: a valid no-op update.
        Assert.Equal([0x00, 0x00], YProtocol.EmptyDocumentUpdate);
    }

    [Fact]
    public void TryReadUpdatePayload_ExtractsUpdatePayload()
    {
        // sync(0) + update(2) + len(1) + payload(0xAB).
        Assert.True(YProtocol.TryReadUpdatePayload([0x00, 0x02, 0x01, 0xAB], out var payload));
        Assert.Equal([0xAB], payload);
    }

    [Fact]
    public void TryReadUpdatePayload_ExtractsStep2Payload()
    {
        // sync(0) + step2(1) + len(2) + payload(0xAA 0xBB).
        Assert.True(YProtocol.TryReadUpdatePayload([0x00, 0x01, 0x02, 0xAA, 0xBB], out var payload));
        Assert.Equal([0xAA, 0xBB], payload);
    }

    [Theory]
    [InlineData(new byte[] { 0x01, 0x00 })]             // awareness → not a doc write
    [InlineData(new byte[] { 0x00, 0x00 })]             // sync step1 → read-only
    [InlineData(new byte[] { 0x00, 0x02, 0x05, 0xAB })] // length overruns the frame
    [InlineData(new byte[] { 0x00 })]                   // truncated sync header
    public void TryReadUpdatePayload_FalseForNonWritesAndMalformed(byte[] message)
    {
        Assert.False(YProtocol.TryReadUpdatePayload(message, out var payload));
        Assert.Empty(payload);
    }

    [Fact]
    public void BuildSyncStep2_FramesPayloadAsStep2()
    {
        // sync(0) + step2(1) + len(1) + payload(0xAB).
        Assert.Equal([0x00, 0x01, 0x01, 0xAB], YProtocol.BuildSyncStep2([0xAB]));
    }

    [Fact]
    public void BuildSyncUpdate_FramesPayloadAsUpdate()
    {
        // sync(0) + update(2) + len(1) + payload(0xAB).
        Assert.Equal([0x00, 0x02, 0x01, 0xAB], YProtocol.BuildSyncUpdate([0xAB]));
    }

    [Fact]
    public void BuildSyncFrame_RoundTripsThroughUpdatePayloadReader()
    {
        byte[] update = [0x01, 0x02, 0x03, 0x04];

        Assert.True(YProtocol.TryReadUpdatePayload(YProtocol.BuildSyncStep2(update), out var fromStep2));
        Assert.Equal(update, fromStep2);

        Assert.True(YProtocol.TryReadUpdatePayload(YProtocol.BuildSyncUpdate(update), out var fromUpdate));
        Assert.Equal(update, fromUpdate);
    }

    [Fact]
    public void WriteVarUint_RoundTripsThroughReader()
    {
        // 300 needs two bytes (0xAC 0x02); confirm write⇄read symmetry.
        var buffer = new List<byte>();
        YProtocol.WriteVarUint(buffer, 300);
        Assert.Equal([0xAC, 0x02], buffer);

        var offset = 0;
        Assert.True(YProtocol.TryReadVarUint(buffer.ToArray(), ref offset, out var value));
        Assert.Equal(300u, value);
        Assert.Equal(2, offset);
    }
}
