using Cadence.Data.Stems;

namespace Cadence.Api.Tests;

/// <summary>Unit tests for the stem catalog and its stable slugs.</summary>
public class StemCatalogTests
{
    [Fact]
    public void All_IsTheSevenLabels_InCatalogOrder()
    {
        Assert.Equal(
            [StemLabel.Bass, StemLabel.Drums, StemLabel.Vocals, StemLabel.Guitar, StemLabel.Keys, StemLabel.Synth, StemLabel.Other],
            StemCatalog.All);
    }

    [Theory]
    [InlineData(StemLabel.Bass, "bass")]
    [InlineData(StemLabel.Vocals, "vocals")]
    [InlineData(StemLabel.Other, "other")]
    public void Slug_IsLowerCasedName(StemLabel label, string expected) =>
        Assert.Equal(expected, StemCatalog.Slug(label));

    [Theory]
    [InlineData("bass", StemLabel.Bass)]
    [InlineData("VOCALS", StemLabel.Vocals)]
    [InlineData("Synth", StemLabel.Synth)]
    public void TryParse_AcceptsCatalogSlugs_CaseInsensitively(string slug, StemLabel expected)
    {
        Assert.True(StemCatalog.TryParse(slug, out var label));
        Assert.Equal(expected, label);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("piano")]
    [InlineData("0")]
    public void TryParse_RejectsUnknownOrEmpty(string? slug) =>
        Assert.False(StemCatalog.TryParse(slug, out _));
}
