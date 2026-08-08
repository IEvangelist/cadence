using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

public class ExternalAuthTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static async Task<HttpResponseMessage> AttemptExternalAsync(
        HttpClient client, string email, string key, string name, bool? emailVerified = null)
    {
        var url = $"/api/auth/external/Mock?email={Uri.EscapeDataString(email)}" +
                  $"&key={Uri.EscapeDataString(key)}&name={Uri.EscapeDataString(name)}";
        if (emailVerified is { } verified)
        {
            url += $"&emailVerified={(verified ? "true" : "false")}";
        }

        var challenge = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        return await client.GetAsync(challenge.Headers.Location);
    }

    private static async Task SignInExternalAsync(
        HttpClient client, string email, string key, string name, bool? emailVerified = null)
    {
        var callback = await AttemptExternalAsync(client, email, key, name, emailVerified);
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

    // Issue B: an external login whose email matches an UNCONFIRMED local account
    // must NOT auto-link or sign in — otherwise an attacker who pre-registered the
    // victim's address hijacks the victim's later OAuth sign-in.
    [Fact]
    public async Task ExternalCallback_DoesNotAutoLink_ToUnconfirmedLocalAccount()
    {
        const string email = "b.unconfirmed@example.com";
        await _factory.CreateClient().RegisterAsync(email); // EmailConfirmed == false

        var client = CreateClient();
        var callback = await AttemptExternalAsync(
            client, email, "attacker-key", "Attacker", emailVerified: true);

        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Contains("reason=link-required", callback.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
        Assert.Equal(0, await _factory.ExternalLoginCountAsync(email));
    }

    // Issue B: even a confirmed local account must not be linked when the provider
    // does not assert the email is verified.
    [Fact]
    public async Task ExternalCallback_DoesNotAutoLink_WhenProviderEmailUnverified()
    {
        const string email = "b.provider-unverified@example.com";
        await _factory.CreateClient().RegisterAsync(email);
        await _factory.ConfirmEmailAsync(email);

        var client = CreateClient();
        var callback = await AttemptExternalAsync(
            client, email, "unverified-key", "User", emailVerified: false);

        Assert.Contains("reason=link-required", callback.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
        Assert.Equal(0, await _factory.ExternalLoginCountAsync(email));
    }

    // Issue B (positive): linking is allowed only when the provider email is
    // verified AND the local account's own email is confirmed.
    [Fact]
    public async Task ExternalCallback_AutoLinks_WhenVerifiedAndConfirmed()
    {
        const string email = "b.linkable@example.com";
        await _factory.CreateClient().RegisterAsync(email);
        await _factory.ConfirmEmailAsync(email);

        var client = CreateClient();
        await SignInExternalAsync(client, email, "linkable-key", "Linkable", emailVerified: true);

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.Equal(1, await _factory.ExternalLoginCountAsync(email));
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
