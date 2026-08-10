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
}
