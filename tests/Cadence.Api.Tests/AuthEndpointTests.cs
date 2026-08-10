using System.Net;
using System.Net.Http.Json;

namespace Cadence.Api.Tests;

public class AuthEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task Register_CreatesUser_AndSignsIn()
    {
        var client = _factory.CreateClient();

        var me = await client.RegisterAndReadMeAsync("register.new@example.com", "Ada Lovelace");

        Assert.Equal("register.new@example.com", me.Email);
        Assert.Equal("Ada Lovelace", me.DisplayName);
        Assert.Equal("Free", me.Tier);

        // The registration cookie authenticates subsequent requests.
        var meResponse = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, meResponse.StatusCode);
    }

    [Fact]
    public async Task Register_DerivesDisplayName_FromEmail_WhenOmitted()
    {
        var client = _factory.CreateClient();

        var me = await client.RegisterAndReadMeAsync("derive.me@example.com");

        Assert.Equal("derive.me", me.DisplayName);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ReturnsValidationProblem()
    {
        const string email = "dup@example.com";
        var client = _factory.CreateClient();
        await client.RegisterAsync(email);

        var second = await _factory.CreateClient().RegisterAsync(email);
        var body = await second.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
        Assert.DoesNotContain(email, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("already taken", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("taken", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("exists", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Register_WeakPassword_ReturnsValidationProblem()
    {
        var client = _factory.CreateClient();

        var response = await client.RegisterAsync("weak@example.com", password: "weak");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Login_WithValidCredentials_Succeeds()
    {
        await _factory.CreateClient().RegisterAsync("login.ok@example.com");

        var client = _factory.CreateClient();
        var response = await client.LoginAsync("login.ok@example.com");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var me = await response.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("login.ok@example.com", me!.Email);
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        await _factory.CreateClient().RegisterAsync("login.bad@example.com");

        var response = await _factory.CreateClient().LoginAsync("login.bad@example.com", "Wrong0rd!");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Login_UnknownUser_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().LoginAsync("nobody@example.com");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Me_WhenAnonymous_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Logout_ClearsSession()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("logout@example.com");

        var logout = await client.PostAsync("/api/auth/logout", content: null);
        Assert.Equal(HttpStatusCode.OK, logout.StatusCode);

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task Logout_WhenAnonymous_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().PostAsync("/api/auth/logout", content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
