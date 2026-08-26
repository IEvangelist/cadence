using Cadence.Api;

namespace Cadence.Api.Tests;

public class CappedStreamReaderTests
{
    [Fact]
    public async Task ReadAsync_FirstReadExceedsCap_StopsImmediately()
    {
        await using var source = new CountingMemoryStream(new byte[17]);

        var result = await CappedStreamReader.ReadAsync(source, cap: 16);

        Assert.Null(result);
        Assert.Equal(1, source.ReadCount);
    }

    private sealed class CountingMemoryStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int ReadCount { get; private set; }

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            ReadCount++;
            return base.ReadAsync(buffer, cancellationToken);
        }
    }
}
