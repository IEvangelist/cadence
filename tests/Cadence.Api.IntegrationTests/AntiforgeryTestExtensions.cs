using System.Net.Http.Json;
using Cadence.Api;

namespace Cadence.Api.IntegrationTests;

internal static class AntiforgeryTestExtensions
{
    public static async Task AddAntiforgeryAsync(this HttpClient client)
    {
        var response = await client.GetAsync("/api/auth/csrf");
        response.EnsureSuccessStatusCode();
        var token = await response.Content.ReadFromJsonAsync<AntiforgeryTokenResponse>();
        client.DefaultRequestHeaders.Remove(CadenceAntiforgery.HeaderName);
        client.DefaultRequestHeaders.Add(CadenceAntiforgery.HeaderName, token!.RequestToken);
    }
}
