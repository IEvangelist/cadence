using System.Text;
using Cadence.Data.Stems;

namespace Cadence.Api.Tests;

/// <summary>
/// Unit tests for the pure model-integrity guards: secure-transport enforcement and
/// SHA-256 verification of the pinned separation model (L4 hardening).
/// </summary>
public class StemModelIntegrityTests
{
    [Theory]
    [InlineData("http://example.com/model.onnx")]
    [InlineData("HTTP://EXAMPLE.COM/model.onnx")]
    public void RequireSecureModelUri_Rejects_Http(string uri) =>
        Assert.Throws<InvalidOperationException>(() => StemModelIntegrity.RequireSecureModelUri(uri));

    [Theory]
    [InlineData("https://example.com/model.onnx")]
    [InlineData("file:///models/htdemucs.onnx")]
    [InlineData("/var/models/htdemucs.onnx")]
    [InlineData("C:\\models\\htdemucs.onnx")]
    public void RequireSecureModelUri_Allows_SecureAndLocal(string uri)
    {
        var ex = Record.Exception(() => StemModelIntegrity.RequireSecureModelUri(uri));
        Assert.Null(ex);
    }

    [Fact]
    public void ComputeSha256Hex_MatchesKnownVector()
    {
        // Well-known: SHA-256("abc").
        const string expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        Assert.Equal(expected, StemModelIntegrity.ComputeSha256Hex("abc"u8));
    }

    [Fact]
    public async Task ComputeSha256HexAsync_MatchesSpanOverload()
    {
        var bytes = Encoding.UTF8.GetBytes("the quick brown fox");
        using var stream = new MemoryStream(bytes);

        var fromStream = await StemModelIntegrity.ComputeSha256HexAsync(stream);
        Assert.Equal(StemModelIntegrity.ComputeSha256Hex(bytes), fromStream);
    }

    [Fact]
    public void VerifyChecksum_Passes_OnMatch_IgnoringCaseAndPrefix()
    {
        var digest = StemModelIntegrity.ComputeSha256Hex("abc"u8);

        // Upper-case, whitespace, and a sha256: prefix are all normalized away.
        var ex = Record.Exception(() =>
            StemModelIntegrity.VerifyChecksum($"  sha256:{digest.ToUpperInvariant()}  ", digest));
        Assert.Null(ex);
    }

    [Fact]
    public void VerifyChecksum_Throws_OnMismatch()
    {
        var actual = StemModelIntegrity.ComputeSha256Hex("abc"u8);
        var wrong = StemModelIntegrity.ComputeSha256Hex("xyz"u8);
        Assert.Throws<InvalidOperationException>(() => StemModelIntegrity.VerifyChecksum(wrong, actual));
    }
}
