using Cadence.Api.Billing;
using Cadence.Data.Entities;
using Microsoft.Extensions.Options;
using Stripe;

namespace Cadence.Api.Tests;

public class StripeWebhookParserTests
{
    private const string Secret = "whsec_test_secret_123";

    private static IStripeWebhookParser CreateParser() =>
        new StripeWebhookParser(Options.Create(new BillingOptions
        {
            Stripe = new StripeOptions { WebhookSecret = Secret },
        }));

    [Fact]
    public void Parse_ValidSignature_SubscriptionUpdated_Normalizes()
    {
        var payload = SubscriptionEventJson("evt_1", "customer.subscription.updated", "active", 1893456000);
        var evt = CreateParser().Parse(payload, StripeTestSigner.Sign(payload, Secret));

        Assert.Equal("evt_1", evt.Id);
        Assert.Equal(BillingEventKind.SubscriptionChanged, evt.Kind);
        Assert.Equal("cus_123", evt.CustomerId);
        Assert.Equal("sub_123", evt.SubscriptionId);
        Assert.Equal(SubscriptionStatus.Active, evt.Status);
        Assert.NotNull(evt.CurrentPeriodEnd);
    }

    [Fact]
    public void Parse_InvalidSignature_Throws()
    {
        var payload = SubscriptionEventJson("evt_2", "customer.subscription.updated", "active", 1893456000);

        // Signed with the wrong secret: verification must fail.
        var badHeader = StripeTestSigner.Sign(payload, "whsec_wrong_secret");

        Assert.Throws<StripeException>(() => CreateParser().Parse(payload, badHeader));
    }

    [Fact]
    public void Parse_TamperedPayload_Throws()
    {
        var payload = SubscriptionEventJson("evt_2b", "customer.subscription.updated", "active", 1893456000);
        var header = StripeTestSigner.Sign(payload, Secret);

        // Same (valid) signature, but the body was changed after signing.
        var tampered = payload.Replace("active", "trialing");

        Assert.Throws<StripeException>(() => CreateParser().Parse(tampered, header));
    }

    [Fact]
    public void Parse_DeletedSubscription_MapsToCanceledFree()
    {
        var payload = SubscriptionEventJson("evt_3", "customer.subscription.deleted", "canceled", 1893456000);
        var evt = CreateParser().Parse(payload, StripeTestSigner.Sign(payload, Secret));

        Assert.Equal(BillingEventKind.SubscriptionDeleted, evt.Kind);
        Assert.Equal(SubscriptionStatus.Canceled, evt.Status);
        Assert.Equal(SubscriptionTier.Free, evt.Status.ToTier());
    }

    [Fact]
    public void Parse_CheckoutCompleted_CarriesClientReference()
    {
        const string payload = """
        {
          "id": "evt_4",
          "object": "event",
          "type": "checkout.session.completed",
          "data": {
            "object": {
              "id": "cs_1",
              "object": "checkout.session",
              "customer": "cus_abc",
              "subscription": "sub_abc",
              "client_reference_id": "user-xyz",
              "mode": "subscription"
            }
          }
        }
        """;

        var evt = CreateParser().Parse(payload, StripeTestSigner.Sign(payload, Secret));

        Assert.Equal(BillingEventKind.CheckoutCompleted, evt.Kind);
        Assert.Equal("cus_abc", evt.CustomerId);
        Assert.Equal("sub_abc", evt.SubscriptionId);
        Assert.Equal("user-xyz", evt.ClientReferenceUserId);
    }

    [Fact]
    public void Parse_InvoicePaymentFailed_MapsToPaymentFailed()
    {
        const string payload = """
        {
          "id": "evt_inv_1",
          "object": "event",
          "type": "invoice.payment_failed",
          "data": { "object": { "id": "in_1", "object": "invoice", "customer": "cus_inv", "status": "open" } }
        }
        """;

        var evt = CreateParser().Parse(payload, StripeTestSigner.Sign(payload, Secret));

        Assert.Equal(BillingEventKind.PaymentFailed, evt.Kind);
        Assert.Equal("cus_inv", evt.CustomerId);
    }

    [Fact]
    public void Parse_UnknownEventType_MapsToUnhandled()
    {
        const string payload = """
        {
          "id": "evt_unh_1",
          "object": "event",
          "type": "customer.created",
          "data": { "object": { "id": "cus_1", "object": "customer" } }
        }
        """;

        var evt = CreateParser().Parse(payload, StripeTestSigner.Sign(payload, Secret));

        Assert.Equal(BillingEventKind.Unhandled, evt.Kind);
    }

    private static string SubscriptionEventJson(string id, string type, string status, long periodEnd) => $$"""
    {
      "id": "{{id}}",
      "object": "event",
      "type": "{{type}}",
      "data": {
        "object": {
          "id": "sub_123",
          "object": "subscription",
          "customer": "cus_123",
          "status": "{{status}}",
          "items": {
            "object": "list",
            "data": [ { "id": "si_1", "object": "subscription_item", "current_period_end": {{periodEnd}} } ]
          }
        }
      }
    }
    """;
}
