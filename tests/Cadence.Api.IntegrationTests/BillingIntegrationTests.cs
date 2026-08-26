using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Aspire.Hosting;
using Aspire.Hosting.Testing;

namespace Cadence.Api.IntegrationTests;

// Drives the billing lifecycle end-to-end against the real Aspire app graph
// (API + Postgres): a signed Stripe webhook flips a freshly registered user from
// the free tier to pro, proving the webhook -> subscription record -> profile
// tier mirror -> entitlements chain persists against real Postgres. The webhook
// signing secret is injected via command-line configuration, which AppHost
// forwards to the API as an environment variable. Requires a container runtime,
// so it is tagged Integration and runs in its own CI job.
[Trait("Category", "Integration")]
public class BillingIntegrationTests
{
    private const string WebhookSecret = "whsec_integration_test_secret";
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromMinutes(5);

    [Fact]
    public async Task Signed_subscription_webhook_flips_entitlements_free_to_pro()
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
            email = "billing.user@example.com",
            password = "Passw0rd!",
            displayName = "Billing User",
        });
        // #76: registration is neutral (202, no cookie); sign in separately.
        Assert.Equal(HttpStatusCode.Accepted, register.StatusCode);

        var login = await client.PostAsJsonAsync("/api/auth/login", new
        {
            email = "billing.user@example.com",
            password = "Passw0rd!",
        });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        await client.AddAntiforgeryAsync();
        var me = await login.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("Free", me!.Tier);

        // Free entitlements: watermarked exports, capped project count.
        var free = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Free", free!.Tier);
        Assert.True(free.WatermarkExports);
        Assert.Equal(10, free.MaxProjects);

        // 1) A completed checkout links the Stripe customer to this user.
        var checkout = await PostWebhookAsync(client, CheckoutCompletedJson("evt_int_checkout", me.Id));
        Assert.Equal(HttpStatusCode.OK, checkout.StatusCode);

        // 2) An active subscription for that customer promotes the user to pro.
        var upgrade = await PostWebhookAsync(client, SubscriptionUpdatedJson("evt_int_upgrade", "active"));
        Assert.Equal(HttpStatusCode.OK, upgrade.StatusCode);

        var pro = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Pro", pro!.Tier);
        Assert.False(pro.WatermarkExports);
        Assert.Equal(-1, pro.MaxProjects);

        // Redelivering the same event id is a no-op (idempotent): still pro.
        var replay = await PostWebhookAsync(client, SubscriptionUpdatedJson("evt_int_upgrade", "active"));
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        var stillPro = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Pro", stillPro!.Tier);
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
          "id": "cs_int",
          "object": "checkout.session",
          "customer": "cus_int",
          "subscription": "sub_int",
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
          "id": "sub_int",
          "object": "subscription",
          "customer": "cus_int",
          "status": "{{status}}",
          "items": {
            "object": "list",
            "data": [ { "id": "si_int", "object": "subscription_item", "current_period_end": 1893456000 } ]
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
}
