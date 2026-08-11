using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Cadence.Api.Tests;

public class AuthEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task Register_ThenSignIn_ReturnsIdentity()
    {
        var client = _factory.CreateClient();

        // RegisterAndReadMeAsync registers then signs in (registration itself no
        // longer authenticates — see the #76 tests below).
        var me = await client.RegisterAndReadMeAsync("register.new@example.com", "Ada Lovelace");

        Assert.Equal("register.new@example.com", me.Email);
        Assert.Equal("Ada Lovelace", me.DisplayName);
        Assert.Equal("Free", me.Tier);

        // The sign-in cookie authenticates subsequent requests.
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
    public async Task Register_NewEmail_Returns202_WithoutCookie()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();

        var response = await client.PostRegisterAsync("register.202@example.com", "Ada Lovelace");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
        Assert.False(response.Headers.Contains("Set-Cookie"));
    }

    // #76: registration must not sign the caller in. Only the emailed verification
    // link activates the account and establishes a session.
    [Fact]
    public async Task Register_DoesNotSignIn()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();

        var register = await client.PostRegisterAsync("register.nosignin@example.com");
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    // #76 core property: a brand-new and an already-registered email must be
    // indistinguishable — byte-identical status and body, and neither sets a cookie.
    [Fact]
    public async Task Register_NewVsExistingEmail_AreByteIdentical_AndCookieless()
    {
        await using var factory = new CadenceApiFactory();
        const string existingEmail = "register.enum-existing@example.com";
        Assert.Equal(HttpStatusCode.Accepted, (await factory.CreateClient().PostRegisterAsync(existingEmail)).StatusCode);

        var existing = await factory.CreateClient().PostRegisterAsync(existingEmail);
        var fresh = await factory.CreateClient().PostRegisterAsync("register.enum-new@example.com");

        Assert.Equal(fresh.StatusCode, existing.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, fresh.StatusCode);
        Assert.Equal(
            await fresh.Content.ReadAsByteArrayAsync(),
            await existing.Content.ReadAsByteArrayAsync());
        Assert.False(existing.Headers.Contains("Set-Cookie"));
        Assert.False(fresh.Headers.Contains("Set-Cookie"));
    }

    // #76: a weak password is rejected the same way (400) for a new and an existing
    // address, so password validation can't be used to enumerate accounts either.
    [Fact]
    public async Task Register_WeakPassword_ReturnsValidationProblem_ForNewAndExisting()
    {
        await using var factory = new CadenceApiFactory();
        const string existingEmail = "register.weak-existing@example.com";
        await factory.CreateClient().PostRegisterAsync(existingEmail);

        var fresh = await factory.CreateClient().PostRegisterAsync("register.weak-new@example.com", password: "weak");
        var existing = await factory.CreateClient().PostRegisterAsync(existingEmail, password: "weak");

        Assert.Equal(HttpStatusCode.BadRequest, fresh.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, existing.StatusCode);
    }

    // #76: the verification link is what activates the account and signs the user in.
    [Fact]
    public async Task Register_ThenVerify_ActivatesAccount_AndSignsIn()
    {
        await using var factory = new CadenceApiFactory();
        const string email = "register.verify@example.com";
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var register = await client.PostRegisterAsync(email, "Grace Hopper");
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        await factory.WaitForEmailsAsync();
        var token = factory.AccountEmails.LastRegistrationVerificationToken;
        Assert.NotNull(token);
        Assert.Equal(email, factory.AccountEmails.LastRegistrationVerificationEmail);
        Assert.Equal(0, factory.AccountEmails.SentCount);

        var verify = await client.GetAsync(
            $"/api/auth/register/verify?email={Uri.EscapeDataString(email)}&token={Uri.EscapeDataString(token!)}");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=success", verify.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        var identity = await me.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal(email, identity!.Email);
    }

    [Fact]
    public async Task Register_Verify_WithBadToken_RedirectsToError()
    {
        await using var factory = new CadenceApiFactory();
        const string email = "register.verify-bad@example.com";
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
        await client.PostRegisterAsync(email);

        var verify = await client.GetAsync(
            $"/api/auth/register/verify?email={Uri.EscapeDataString(email)}&token=not-a-real-token");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());

        var me = await client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task Register_Verify_ForUnknownEmail_RedirectsToError()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

        var verify = await client.GetAsync(
            $"/api/auth/register/verify?email={Uri.EscapeDataString("register.ghost@example.com")}&token=whatever");

        Assert.Equal(HttpStatusCode.Redirect, verify.StatusCode);
        Assert.Contains("auth=error", verify.Headers.Location!.ToString());
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
