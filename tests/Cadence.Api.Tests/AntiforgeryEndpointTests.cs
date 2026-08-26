using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Cadence.Api.Tests;

public class AntiforgeryEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    [Fact]
    public async Task Token_endpoint_requires_an_authenticated_session()
    {
        var response = await _factory.CreateClient().GetAsync("/api/auth/csrf");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Valid_cookie_and_header_allow_an_authenticated_mutation()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("csrf.valid@example.com");

        var response = await client.PostAsJsonAsync(
            "/api/projects",
            new SaveProjectRequest("csrf-valid", "Protected", 1, "{}"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Missing_header_is_rejected_before_the_mutation_runs()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("csrf.missing@example.com");
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);

        var response = await client.PostAsJsonAsync(
            "/api/projects",
            new SaveProjectRequest("csrf-missing", "Must not exist", 1, "{}"));

        await AssertInvalidAntiforgeryAsync(response);
        Assert.Empty(await client.GetFromJsonAsync<List<ProjectSummary>>("/api/projects") ?? []);
    }

    [Fact]
    public async Task Invalid_header_is_rejected()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("csrf.invalid@example.com");
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);
        client.DefaultRequestHeaders.Add(CadenceAntiforgery.HeaderName, "not-a-token");

        var response = await client.PutAsJsonAsync("/api/profile", new UpdateProfileRequest("Changed", null, null));

        await AssertInvalidAntiforgeryAsync(response);
    }

    [Fact]
    public async Task Explicit_report_only_rollout_mode_accepts_but_does_not_hide_missing_tokens()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?>
            {
                [CadenceAntiforgery.EnforcedConfigKey] = "false",
            },
        };
        var client = factory.CreateClient();
        await client.RegisterAsync("csrf.rollout@example.com");
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);

        var response = await client.PostAsJsonAsync(
            "/api/projects",
            new SaveProjectRequest("rollout", "Rollout", 1, "{}"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Theory]
    [InlineData("POST", "/api/auth/logout", null, null)]
    [InlineData("PUT", "/api/profile", "application/json", "{}")]
    [InlineData("POST", "/api/projects", "application/json", "{}")]
    [InlineData("PUT", "/api/projects/missing", "application/json", "{}")]
    [InlineData("DELETE", "/api/projects/missing", null, null)]
    [InlineData("POST", "/api/billing/checkout", null, null)]
    [InlineData("POST", "/api/billing/portal", null, null)]
    [InlineData("POST", "/api/projects/missing/shares", "application/json", "{}")]
    [InlineData("DELETE", "/api/projects/missing/shares/missing", null, null)]
    [InlineData("POST", "/api/stems/jobs?name=mix.wav", "audio/wav", "not-a-wave")]
    public async Task Every_authenticated_mutation_surface_requires_antiforgery(
        string method,
        string path,
        string? contentType,
        string? body)
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync($"csrf.matrix.{Guid.NewGuid():N}@example.com");
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (body is not null)
        {
            request.Content = new StringContent(body, Encoding.UTF8, contentType!);
        }

        var response = await client.SendAsync(request);

        await AssertInvalidAntiforgeryAsync(response);
    }

    [Fact]
    public async Task Optional_authenticated_ai_mutation_requires_antiforgery()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["Ai:ServerSide:Enabled"] = "true" },
        };
        var client = factory.CreateClient();
        await client.RegisterAsync("csrf.ai@example.com");
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);

        var response = await client.PostAsJsonAsync("/api/ai/generate", new { action = "generate", @params = new { } });

        await AssertInvalidAntiforgeryAsync(response);
    }

    [Fact]
    public async Task Public_auth_entry_points_and_signed_webhook_do_not_require_antiforgery()
    {
        var client = _factory.CreateClient();
        var suffix = Guid.NewGuid().ToString("N");

        var register = await client.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest($"csrf.public.{suffix}@example.com", AuthTestExtensions.ValidPassword, null));
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginRequest($"unknown.{suffix}@example.com", AuthTestExtensions.ValidPassword));
        var magic = await client.PostAsJsonAsync(
            "/api/auth/magic-link",
            new MagicLinkRequest($"unknown.{suffix}@example.com"));
        var webhook = await client.PostAsync(
            "/api/billing/webhook",
            new StringContent("{}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        Assert.Equal(HttpStatusCode.Accepted, magic.StatusCode);
        Assert.NotEqual(CadenceAntiforgery.InvalidTokenProblemType, await ProblemTypeAsync(webhook));
    }

    [Fact]
    public async Task Token_cookie_follows_cross_site_auth_policy_and_rotated_pairs_fail_closed()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?>
            {
                [CadenceIdentityExtensions.CookieSameSiteConfigKey] = "None",
            },
        };
        var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false,
            BaseAddress = new Uri("https://localhost"),
        });
        var email = $"csrf.none.{Guid.NewGuid():N}@example.com";
        await (await client.PostRegisterAsync(email)).Content.LoadIntoBufferAsync();
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new LoginRequest(email, AuthTestExtensions.ValidPassword));
        var authCookie = CookiePair(login, "cadence.auth");

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
        tokenRequest.Headers.Add("Cookie", authCookie);
        var tokenResponse = await client.SendAsync(tokenRequest);
        var firstToken = (await tokenResponse.Content.ReadFromJsonAsync<AntiforgeryTokenResponse>())!.RequestToken;
        var firstCookie = CookiePair(tokenResponse, CadenceAntiforgery.CookieName);
        var setCookie = Assert.Single(tokenResponse.Headers.GetValues("Set-Cookie"));

        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=none", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("no-store", tokenResponse.Headers.CacheControl?.ToString());

        // Presenting an invalid cookie makes the token endpoint rotate the pair.
        using var rotateRequest = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
        rotateRequest.Headers.Add("Cookie", $"{authCookie}; {CadenceAntiforgery.CookieName}=invalid");
        var rotateResponse = await client.SendAsync(rotateRequest);
        var secondToken = (await rotateResponse.Content.ReadFromJsonAsync<AntiforgeryTokenResponse>())!.RequestToken;
        var secondCookie = CookiePair(rotateResponse, CadenceAntiforgery.CookieName);

        var mismatched = await SendProjectAsync(client, authCookie, firstCookie, secondToken, "mismatch");
        await AssertInvalidAntiforgeryAsync(mismatched);

        var rotated = await SendProjectAsync(client, authCookie, secondCookie, secondToken, "rotated");
        Assert.Equal(HttpStatusCode.Created, rotated.StatusCode);
        Assert.NotEqual(firstToken, secondToken);
    }

    private static async Task<HttpResponseMessage> SendProjectAsync(
        HttpClient client,
        string authCookie,
        string antiforgeryCookie,
        string token,
        string id)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/projects");
        request.Headers.Add("Cookie", $"{authCookie}; {antiforgeryCookie}");
        request.Headers.Add(CadenceAntiforgery.HeaderName, token);
        request.Content = JsonContent.Create(new SaveProjectRequest(id, id, 1, "{}"));
        return await client.SendAsync(request);
    }

    private static string CookiePair(HttpResponseMessage response, string name) =>
        response.Headers.GetValues("Set-Cookie")
            .Select(value => value.Split(';')[0])
            .Single(value => value.StartsWith($"{name}=", StringComparison.Ordinal));

    private static async Task AssertInvalidAntiforgeryAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(CadenceAntiforgery.InvalidTokenProblemType, await ProblemTypeAsync(response));
    }

    private static async Task<string?> ProblemTypeAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        using var document = JsonDocument.Parse(text);
        return document.RootElement.TryGetProperty("type", out var type) ? type.GetString() : null;
    }

    private sealed record ProjectSummary(string Id, string Name);
}
