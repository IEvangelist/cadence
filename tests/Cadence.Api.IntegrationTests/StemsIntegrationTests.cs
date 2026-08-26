using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace Cadence.Api.IntegrationTests;

// Drives the full stem-separation pipeline end-to-end against the real Aspire app
// graph (API + separation worker + Postgres + Azurite blob). A freshly registered
// free user is blocked (402), a signed Stripe webhook promotes them to pro, and the
// worker (deterministic band-split engine, no model configured) processes an
// uploaded mix into the labeled stem catalog which is then downloaded back. This
// proves the queue -> worker -> Blob -> download chain persists against real
// infrastructure. Requires a container runtime, so it is tagged Integration.
[Trait("Category", "Integration")]
public class StemsIntegrationTests
{
    private const string WebhookSecret = "whsec_integration_test_secret";
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(3);

    [Fact]
    public async Task Free_user_blocked_then_pro_user_separates_mix_end_to_end()
    {
        var appHost = await DistributedApplicationTestingBuilder
            .CreateAsync<Projects.Cadence_AppHost>(
                [$"--Billing:Stripe:WebhookSecret={WebhookSecret}"]);

        await using var app = await appHost.BuildAsync();
        await app.StartAsync();

        await app.ResourceNotifications
            .WaitForResourceHealthyAsync("api")
            .WaitAsync(ReadyTimeout);

        var baseAddress = app.GetEndpoint("api");
        using var handler = new HttpClientHandler
        {
            UseCookies = true,
            CookieContainer = new CookieContainer(),
            AllowAutoRedirect = false,
        };
        using var client = new HttpClient(handler) { BaseAddress = baseAddress };

        // Register a user; new accounts start on the free tier.
        var register = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "stems.integration@example.com",
            password = "Passw0rd!",
            displayName = "Stems User",
        });
        // #76: registration is neutral (202, no cookie); sign in separately.
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "stems.integration@example.com",
            password = "Passw0rd!",
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        await client.AddAntiforgeryAsync();
        var me = await login.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("Free", me!.Tier);

        var mix = CreateMixWav();

        // Free tier has no StemSeparation entitlement -> 402 problem+json.
        var blocked = await UploadAsync(client, mix);
        Assert.Equal(HttpStatusCode.PaymentRequired, blocked.StatusCode);

        // Promote to pro via the same signed-webhook chain the billing tests use.
        Assert.Equal(HttpStatusCode.OK,
            (await PostWebhookAsync(client, CheckoutCompletedJson("evt_stem_checkout", me.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await PostWebhookAsync(client, SubscriptionUpdatedJson("evt_stem_upgrade", "active"))).StatusCode);

        var entitlements = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Pro", entitlements!.Tier);
        Assert.True(entitlements.StemSeparation);

        // Upload the mix -> 202 Accepted, queued for the worker.
        var create = await UploadAsync(client, mix, "integration-mix.wav");
        Assert.Equal(HttpStatusCode.Accepted, create.StatusCode);
        var queued = await create.Content.ReadFromJsonAsync<StemJobDetailDto>();
        Assert.Equal("Queued", queued!.Status);
        Assert.NotNull(create.Headers.Location);

        // The worker claims and processes it; poll until it reaches a terminal state.
        var completed = await PollUntilTerminalAsync(client, queued.Id);
        Assert.Equal("Completed", completed.Status);
        Assert.NotNull(completed.CompletedAt);

        // The full labeled catalog is produced, in order.
        Assert.Equal(
            new[] { "bass", "drums", "vocals", "guitar", "keys", "synth", "other" },
            completed.Stems.Select(s => s.Label).ToArray());

        // It appears in the owner's listing.
        var list = await client.GetFromJsonAsync<List<StemJobSummaryDto>>("/api/stems/jobs");
        Assert.Contains(list!, j => j.Id == queued.Id);

        // Each stem downloads from Blob as a real WAV.
        foreach (var stem in completed.Stems)
        {
            var download = await client.GetAsync(stem.Url);
            Assert.Equal(HttpStatusCode.OK, download.StatusCode);
            Assert.Equal("audio/wav", download.Content.Headers.ContentType!.MediaType);
            var bytes = await download.Content.ReadAsByteArrayAsync();
            Assert.True(bytes.Length > 44);
            Assert.Equal("RIFF"u8.ToArray(), bytes[..4]);
        }
    }

    private static async Task<StemJobDetailDto> PollUntilTerminalAsync(HttpClient client, string id)
    {
        using var cts = new CancellationTokenSource(JobTimeout);
        while (true)
        {
            var job = await client.GetFromJsonAsync<StemJobDetailDto>($"/api/stems/jobs/{id}", cts.Token);
            if (job!.Status is "Completed" or "Failed")
            {
                return job;
            }

            await Task.Delay(TimeSpan.FromSeconds(2), cts.Token);
        }
    }

    private static Task<HttpResponseMessage> UploadAsync(HttpClient client, byte[] wav, string name = "mix.wav")
    {
        var content = new ByteArrayContent(wav);
        content.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        return client.PostAsync($"/api/stems/jobs?name={Uri.EscapeDataString(name)}", content);
    }

    // A minimal 16-bit PCM stereo WAV: a quarter second of a quiet tone at 44.1 kHz.
    private static byte[] CreateMixWav()
    {
        const int sampleRate = 44100;
        const int channels = 2;
        const int frames = sampleRate / 4;
        var data = new byte[frames * channels * 2];
        for (var f = 0; f < frames; f++)
        {
            var sample = (short)(Math.Sin(2 * Math.PI * 220 * f / sampleRate) * 8000);
            for (var c = 0; c < channels; c++)
            {
                var idx = ((f * channels) + c) * 2;
                data[idx] = (byte)(sample & 0xFF);
                data[idx + 1] = (byte)((sample >> 8) & 0xFF);
            }
        }

        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream);
        var byteRate = sampleRate * channels * 2;
        writer.Write("RIFF"u8);
        writer.Write(36 + data.Length);
        writer.Write("WAVE"u8);
        writer.Write("fmt "u8);
        writer.Write(16);
        writer.Write((short)1);
        writer.Write((short)channels);
        writer.Write(sampleRate);
        writer.Write(byteRate);
        writer.Write((short)(channels * 2));
        writer.Write((short)16);
        writer.Write("data"u8);
        writer.Write(data.Length);
        writer.Write(data);
        writer.Flush();
        return stream.ToArray();
    }

    private static async Task<HttpResponseMessage> PostWebhookAsync(HttpClient client, string payload)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/billing/webhook")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Stripe-Signature", Sign(payload, WebhookSecret));
        return await client.SendAsync(request);
    }

    // Reproduces Stripe's signature scheme: HMAC-SHA256 over "{timestamp}.{payload}".
    private static string Sign(string payload, string secret)
    {
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{ts}.{payload}"));
        return $"t={ts},v1={Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static string CheckoutCompletedJson(string eventId, string userId) => $$"""
    {
      "id": "{{eventId}}",
      "object": "event",
      "type": "checkout.session.completed",
      "data": {
        "object": {
          "id": "cs_stem",
          "object": "checkout.session",
          "customer": "cus_stem",
          "subscription": "sub_stem",
          "client_reference_id": "{{userId}}",
          "mode": "subscription"
        }
      }
    }
    """;

    private static string SubscriptionUpdatedJson(string eventId, string status) => $$"""
    {
      "id": "{{eventId}}",
      "object": "event",
      "type": "customer.subscription.updated",
      "data": {
        "object": {
          "id": "sub_stem",
          "object": "subscription",
          "customer": "cus_stem",
          "status": "{{status}}",
          "items": {
            "object": "list",
            "data": [ { "id": "si_stem", "object": "subscription_item", "current_period_end": 1893456000 } ]
          }
        }
      }
    }
    """;

    private sealed record MeResponse(string Id, string Email, string DisplayName, string Tier);

    private sealed record EntitlementsResponse(
        string Tier,
        bool WatermarkExports,
        int MaxProjects,
        int AiGenerationsPerDay,
        bool AdvancedFormats,
        bool StemSeparation,
        int CollaborationSeats);

    private sealed record StemJobSummaryDto(
        string Id,
        string Status,
        string OriginalFileName,
        long SizeBytes,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        DateTimeOffset? CompletedAt);

    private sealed record StemJobDetailDto(
        string Id,
        string Status,
        string OriginalFileName,
        string ContentType,
        long SizeBytes,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt,
        DateTimeOffset? CompletedAt,
        string? ErrorMessage,
        IReadOnlyList<StemDto> Stems);

    private sealed record StemDto(string Label, long SizeBytes, string Url);
}
