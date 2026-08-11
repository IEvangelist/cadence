using System.Net;
using System.Net.Http.Json;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>Shared helpers for driving the auth endpoints from tests.</summary>
internal static class AuthTestExtensions
{
    /// <summary>A password that satisfies the default Identity complexity rules.</summary>
    public const string ValidPassword = "Passw0rd!";

    /// <summary>
    /// POST the raw registration request and return the untouched response, so tests
    /// can assert on the endpoint's actual contract (202 for new/existing, 400 for
    /// invalid input). Does NOT sign the client in.
    /// </summary>
    public static Task<HttpResponseMessage> PostRegisterAsync(
        this HttpClient client, string email, string? displayName = null, string password = ValidPassword) =>
        client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, password, displayName));

    /// <summary>
    /// Register a local account and leave the client authenticated. Registration no
    /// longer signs in (#76: it returns a neutral 202 and defers sign-in to email
    /// verification), so this helper completes the flow with a login and returns the
    /// login response — which carries the auth cookie exactly as the old register
    /// response did. This keeps the many "seed an authenticated user" call sites
    /// working unchanged. If registration itself is rejected (e.g. a weak password),
    /// that response is returned as-is without attempting to sign in.
    /// </summary>
    public static async Task<HttpResponseMessage> RegisterAsync(
        this HttpClient client, string email, string? displayName = null, string password = ValidPassword)
    {
        var register = await client.PostRegisterAsync(email, displayName, password);
        if (register.StatusCode != HttpStatusCode.Accepted)
        {
            return register;
        }

        register.Dispose();
        return await client.LoginAsync(email, password);
    }

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

    /// <summary>True when a local account exists for the given email.</summary>
    public static async Task<bool> UserExistsAsync(this CadenceApiFactory factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        return await users.FindByEmailAsync(email) is not null;
    }

    /// <summary>Number of external logins linked to the account, or -1 if no account exists.</summary>
    public static async Task<int> ExternalLoginCountAsync(this CadenceApiFactory factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            return -1;
        }

        var logins = await users.GetLoginsAsync(user);
        return logins.Count;
    }

    /// <summary>Confirm a user's email out-of-band (simulates a completed confirmation round-trip).</summary>
    public static async Task ConfirmEmailAsync(this CadenceApiFactory factory, string email)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email)
            ?? throw new InvalidOperationException($"No user for '{email}'.");
        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        var result = await users.ConfirmEmailAsync(user, token);
        if (!result.Succeeded)
        {
            throw new InvalidOperationException("Failed to confirm email.");
        }
    }
}
