using System.Net.Http.Json;

namespace Cadence.Api.Tests;

/// <summary>Shared helpers for driving the auth endpoints from tests.</summary>
internal static class AuthTestExtensions
{
    /// <summary>A password that satisfies the default Identity complexity rules.</summary>
    public const string ValidPassword = "Passw0rd!";

    /// <summary>Register a new local account (auto-signs the client in on success).</summary>
    public static Task<HttpResponseMessage> RegisterAsync(
        this HttpClient client, string email, string? displayName = null, string password = ValidPassword) =>
        client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, password, displayName));

    /// <summary>Sign in with a local account.</summary>
    public static Task<HttpResponseMessage> LoginAsync(
        this HttpClient client, string email, string password = ValidPassword) =>
        client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));

    /// <summary>Register a fresh user and return the authenticated client's identity.</summary>
    public static async Task<MeResponse> RegisterAndReadMeAsync(
        this HttpClient client, string email, string? displayName = null)
    {
        var response = await client.RegisterAsync(email, displayName);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<MeResponse>())!;
    }
}
