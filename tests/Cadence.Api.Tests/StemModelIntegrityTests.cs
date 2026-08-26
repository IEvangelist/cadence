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
    [InlineData(" \thttp://example.com/model.onnx\r\n ")]
    [InlineData("ftp://example.com/model.onnx")]
    public void RequireSecureModelUri_Rejects_InsecureOrUnsupportedRemoteScheme(string uri) =>
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

    [Theory]
    [InlineData(" \thttps://example.com/model.onnx\r\n ", StemModelLocationKind.Https, "https://example.com/model.onnx")]
    [InlineData(" \tfile:///models/model.onnx\r\n ", StemModelLocationKind.FileUri, "file:///models/model.onnx")]
    [InlineData(" \tC:\\models\\model.onnx\r\n ", StemModelLocationKind.LocalPath, "C:\\models\\model.onnx")]
    public void ParseModelLocation_TrimsAndClassifiesConsistently(
        string configured,
        StemModelLocationKind expectedKind,
        string expectedReference)
    {
        var location = StemModelIntegrity.ParseModelLocation(configured);

        Assert.Equal(expectedKind, location.Kind);
        Assert.Equal(expectedReference, location.Reference);
        Assert.Equal(expectedKind == StemModelLocationKind.Https, location.IsRemote);
        if (expectedKind == StemModelLocationKind.LocalPath)
        {
            Assert.Equal(expectedReference, location.LocalPath);
        }
        else if (expectedKind == StemModelLocationKind.FileUri)
        {
            Assert.Equal(location.ParsedUri!.LocalPath, location.LocalPath);
        }
        else
        {
            Assert.Throws<InvalidOperationException>(() => location.LocalPath);
        }
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
