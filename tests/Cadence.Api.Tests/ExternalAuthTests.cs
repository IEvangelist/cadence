using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

public class ExternalAuthTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static async Task SignInExternalAsync(HttpClient client, string email, string key, string name)
    {
        var challenge = await client.GetAsync(
            $"/api/auth/external/Mock?email={Uri.EscapeDataString(email)}" +
            $"&key={Uri.EscapeDataString(key)}&name={Uri.EscapeDataString(name)}");
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);

        var callback = await client.GetAsync(challenge.Headers.Location);
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Contains("auth=success", callback.Headers.Location!.ToString());
    }

    [Fact]
    public async Task ExternalSignIn_CreatesUser_AndAuthenticates()
    {
        var client = CreateClient();

        await SignInExternalAsync(client, "ext.new@example.com", "ext-key-1", "External Person");

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var identity = await me.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("ext.new@example.com", identity!.Email);
        Assert.Equal("External Person", identity.DisplayName);
    }

    [Fact]
    public async Task ExternalSignIn_IsIdempotent_ForReturningUser()
    {
        await SignInExternalAsync(CreateClient(), "ext.return@example.com", "ext-key-2", "Return User");

        // A second sign-in with the same provider key logs the existing user in.
        var client = CreateClient();
        await SignInExternalAsync(client, "ext.return@example.com", "ext-key-2", "Return User");

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task ExternalChallenge_UnknownProvider_ReturnsNotFound()
    {
        var response = await CreateClient().GetAsync("/api/auth/external/Nonexistent");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ExternalCallback_WithoutChallenge_RedirectsToError()
    {
        var response = await CreateClient().GetAsync("/api/auth/external/callback");

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Contains("auth=error", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Providers_ListsMockScheme_InTestingEnvironment()
    {
        var response = await _factory.CreateClient().GetAsync("/api/auth/providers");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var providers = await response.Content.ReadFromJsonAsync<ProvidersResponse>();
        Assert.Contains("Mock", providers!.Providers);
    }
}
