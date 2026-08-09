using System.Net;
using System.Net.Http.Json;
using System.Text;
using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>
/// Endpoint-level tests for the entitlement + billing surface. Billing is enabled
/// per-test via config overrides, and the Stripe API is always faked so no test
/// touches the network.
/// </summary>
public class BillingEndpointTests
{
    private const string WebhookSecret = "whsec_endpoint_test";

    private static Dictionary<string, string?> BillingConfig(bool withWebhookSecret = false)
    {
        var config = new Dictionary<string, string?>
        {
            ["Billing:Stripe:SecretKey"] = "sk_test_dummy",
            ["Billing:Stripe:PriceId"] = "price_dummy",
        };
        if (withWebhookSecret)
        {
            config["Billing:Stripe:WebhookSecret"] = WebhookSecret;
        }

        return config;
    }

    [Fact]
    public async Task Entitlements_RequiresAuth()
    {
        await using var factory = new CadenceApiFactory();
        var response = await factory.CreateClient().GetAsync("/api/entitlements");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Entitlements_FreeUser_ReportsGenerousFreeTier()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        await client.RegisterAsync("ent.free@example.com");

        var response = await client.GetAsync("/api/entitlements");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<EntitlementsResponse>();

        Assert.Equal("Free", body!.Tier);
        Assert.True(body.WatermarkExports);
        Assert.True(body.MaxProjects > 0);
        Assert.False(body.AdvancedFormats);
    }

    [Fact]
    public async Task Checkout_WhenBillingNotConfigured_ReturnsServiceUnavailable()
    {
        await using var factory = new CadenceApiFactory { BillingGateway = new FakeBillingGateway() };
        var client = factory.CreateClient();
        await client.RegisterAsync("checkout.off@example.com");

        var response = await client.PostAsync("/api/billing/checkout", content: null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Checkout_WhenConfigured_ReturnsUrlAndPersistsCustomer()
    {
        var gateway = new FakeBillingGateway { CheckoutUrl = "https://stripe.test/checkout/abc", CustomerId = "cus_persist_1" };
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = BillingConfig(),
            BillingGateway = gateway,
        };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("checkout.on@example.com");

        var response = await client.PostAsync("/api/billing/checkout", content: null);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<BillingUrlResponse>();
        Assert.Equal("https://stripe.test/checkout/abc", body!.Url);
        Assert.Equal(me.Id, gateway.LastCheckout!.UserId);

        // The Stripe customer id returned by checkout is persisted for later webhooks.
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        var sub = db.Subscriptions.Single(s => s.UserId == me.Id);
        Assert.Equal("cus_persist_1", sub.StripeCustomerId);
    }

    [Fact]
    public async Task Portal_FreeUserWithoutSubscription_Returns402()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = BillingConfig(),
            BillingGateway = new FakeBillingGateway(),
        };
        var client = factory.CreateClient();
        await client.RegisterAsync("portal.free@example.com");

        var response = await client.PostAsync("/api/billing/portal", content: null);

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
    }

    [Fact]
    public async Task Portal_SubscribedUser_ReturnsPortalUrl()
    {
        var gateway = new FakeBillingGateway { PortalUrl = "https://stripe.test/portal/xyz" };
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = BillingConfig(),
            BillingGateway = gateway,
        };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("portal.paid@example.com");

        // Simulate an established billing relationship.
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
            db.Subscriptions.Add(new Subscription
            {
                UserId = me.Id,
                StripeCustomerId = "cus_paid_1",
                Status = SubscriptionStatus.Active,
                Tier = SubscriptionTier.Pro,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var response = await client.PostAsync("/api/billing/portal", content: null);

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<BillingUrlResponse>();
        Assert.Equal("https://stripe.test/portal/xyz", body!.Url);
        Assert.Equal("cus_paid_1", gateway.LastPortal!.Value.CustomerId);
    }

    [Fact]
    public async Task Webhook_WithoutSigningSecret_IsUnavailable()
    {
        await using var factory = new CadenceApiFactory();
        var response = await factory.CreateClient().PostAsync(
            "/api/billing/webhook",
            new StringContent("{}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_InvalidSignature_Returns400()
    {
        await using var factory = new CadenceApiFactory { ConfigOverrides = BillingConfig(withWebhookSecret: true) };
        var content = new StringContent("{\"id\":\"evt\"}", Encoding.UTF8, "application/json");
        content.Headers.Add("Stripe-Signature", "t=1,v1=deadbeef");

        var response = await factory.CreateClient().PostAsync("/api/billing/webhook", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Webhook_SubscriptionActive_FlipsEntitlementToPro_Idempotently()
    {
        await using var factory = new CadenceApiFactory { ConfigOverrides = BillingConfig(withWebhookSecret: true) };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("webhook.flip@example.com");

        // 1) Checkout completed links the Stripe customer to this user.
        await PostWebhookAsync(factory, client, CheckoutCompletedJson("evt_co_1", "cus_flip", "sub_flip", me.Id));

        // 2) Subscription becomes active -> tier flips to Pro.
        var activeJson = SubscriptionJson("evt_active_1", "customer.subscription.updated", "cus_flip", "active");
        await PostWebhookAsync(factory, client, activeJson);

        var afterActive = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Pro", afterActive!.Tier);
        Assert.False(afterActive.WatermarkExports);

        // 3) Redeliver the SAME event id -> still Pro, and only one ledger entry.
        await PostWebhookAsync(factory, client, activeJson);

        var afterReplay = await client.GetFromJsonAsync<EntitlementsResponse>("/api/entitlements");
        Assert.Equal("Pro", afterReplay!.Tier);

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        Assert.Equal(1, db.ProcessedBillingEvents.Count(e => e.EventId == "evt_active_1"));
    }

    private static async Task PostWebhookAsync(CadenceApiFactory factory, HttpClient client, string payload)
    {
        var content = new StringContent(payload, Encoding.UTF8, "application/json");
        content.Headers.Add("Stripe-Signature", StripeTestSigner.Sign(payload, WebhookSecret));
        var response = await client.PostAsync("/api/billing/webhook", content);
        response.EnsureSuccessStatusCode();
    }

    private static string CheckoutCompletedJson(string id, string customer, string subscription, string userId) => $$"""
    {
      "id": "{{id}}",
      "object": "event",
      "type": "checkout.session.completed",
      "data": { "object": {
        "id": "cs_1", "object": "checkout.session",
        "customer": "{{customer}}", "subscription": "{{subscription}}",
        "client_reference_id": "{{userId}}", "mode": "subscription"
      } }
    }
    """;

    private static string SubscriptionJson(string id, string type, string customer, string status) => $$"""
    {
      "id": "{{id}}",
      "object": "event",
      "type": "{{type}}",
      "data": { "object": {
        "id": "sub_flip", "object": "subscription",
        "customer": "{{customer}}", "status": "{{status}}",
        "items": { "object": "list", "data": [ { "id": "si_1", "object": "subscription_item", "current_period_end": 1893456000 } ] }
      } }
    }
    """;
}
