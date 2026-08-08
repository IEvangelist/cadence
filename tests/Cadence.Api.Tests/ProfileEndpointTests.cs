using System.Net;
using System.Net.Http.Json;

namespace Cadence.Api.Tests;

public class ProfileEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task GetProfile_ReturnsDefaults_WithFreeTier()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("profile.get@example.com", "Grace Hopper");

        var response = await client.GetAsync("/api/profile");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var profile = await response.Content.ReadFromJsonAsync<ProfileResponse>();
        Assert.Equal("Grace Hopper", profile!.DisplayName);
        Assert.Equal("Free", profile.Tier);
        Assert.Null(profile.Bio);
    }

    [Fact]
    public async Task UpdateProfile_PersistsChanges()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("profile.update@example.com");

        var update = await client.PutAsJsonAsync("/api/profile",
            new UpdateProfileRequest("New Name", "A short bio.", "https://example.com/a.png"));

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var profile = await update.Content.ReadFromJsonAsync<ProfileResponse>();
        Assert.Equal("New Name", profile!.DisplayName);
        Assert.Equal("A short bio.", profile.Bio);
        Assert.Equal("https://example.com/a.png", profile.AvatarUrl);

        // The display-name change is reflected on the identity summary too.
        var me = await (await client.GetAsync("/api/auth/me")).Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("New Name", me!.DisplayName);
    }

    [Fact]
    public async Task UpdateProfile_LeavesOmittedFieldsUnchanged()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("profile.partial@example.com", "Original");
        await client.PutAsJsonAsync("/api/profile",
            new UpdateProfileRequest(null, "Only bio changes.", null));

        var profile = await (await client.GetAsync("/api/profile"))
            .Content.ReadFromJsonAsync<ProfileResponse>();

        Assert.Equal("Original", profile!.DisplayName);
        Assert.Equal("Only bio changes.", profile.Bio);
    }

    [Fact]
    public async Task Profile_WhenAnonymous_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().GetAsync("/api/profile");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
