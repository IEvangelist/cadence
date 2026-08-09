using Cadence.Data.Entities;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;
using StripeSubscription = Stripe.Subscription;

namespace Cadence.Api.Billing;

/// <summary>
/// Verifies a Stripe webhook's signature and normalizes it into a
/// <see cref="BillingEvent"/>. Kept behind a seam so the webhook endpoint has no
/// direct dependency on Stripe SDK types and can be tested without them.
/// </summary>
public interface IStripeWebhookParser
{
    /// <summary>
    /// Verify the <c>Stripe-Signature</c> header against the raw request body and
    /// return the normalized event.
    /// </summary>
    /// <exception cref="StripeException">The signature is missing or invalid.</exception>
    BillingEvent Parse(string payload, string signatureHeader);
}

/// <summary>
/// Default <see cref="IStripeWebhookParser"/> backed by Stripe's
/// <see cref="EventUtility.ConstructEvent(string, string, string, long, bool)"/>,
/// which performs the constant-time HMAC-SHA256 signature check. The webhook
/// secret comes from configuration; a request whose signature does not verify
/// throws and is surfaced by the endpoint as <c>400 Bad Request</c>.
/// </summary>
public sealed class StripeWebhookParser(IOptions<BillingOptions> options) : IStripeWebhookParser
{
    private readonly BillingOptions _options = options.Value;

    /// <inheritdoc />
    public BillingEvent Parse(string payload, string signatureHeader)
    {
        // throwOnApiVersionMismatch:false so an event minted with a slightly
        // different Stripe API version is still accepted once its signature is
        // verified — the fields we read are stable across recent versions.
        var stripeEvent = EventUtility.ConstructEvent(
            payload,
            signatureHeader,
            _options.Stripe.WebhookSecret,
            tolerance: 300,
            throwOnApiVersionMismatch: false);

        return Normalize(stripeEvent);
    }

    private static BillingEvent Normalize(Event stripeEvent)
    {
        var kind = StripeStatusMap.ToEventKind(stripeEvent.Type);
        var data = stripeEvent.Data.Object;

        return kind switch
        {
            BillingEventKind.CheckoutCompleted when data is Session session => new BillingEvent(
                stripeEvent.Id,
                stripeEvent.Type,
                kind,
                session.CustomerId,
                session.SubscriptionId,
                session.ClientReferenceId,
                SubscriptionStatus.None,
                CurrentPeriodEnd: null),

            BillingEventKind.SubscriptionChanged when data is StripeSubscription sub => new BillingEvent(
                stripeEvent.Id,
                stripeEvent.Type,
                kind,
                sub.CustomerId,
                sub.Id,
                ClientReferenceUserId: null,
                StripeStatusMap.ToSubscriptionStatus(sub.Status),
                ResolvePeriodEnd(sub)),

            BillingEventKind.SubscriptionDeleted when data is StripeSubscription sub => new BillingEvent(
                stripeEvent.Id,
                stripeEvent.Type,
                kind,
                sub.CustomerId,
                sub.Id,
                ClientReferenceUserId: null,
                SubscriptionStatus.Canceled,
                ResolvePeriodEnd(sub)),

            BillingEventKind.PaymentSucceeded or BillingEventKind.PaymentFailed when data is Invoice invoice => new BillingEvent(
                stripeEvent.Id,
                stripeEvent.Type,
                kind,
                invoice.CustomerId,
                SubscriptionId: null,
                ClientReferenceUserId: null,
                SubscriptionStatus.None,
                CurrentPeriodEnd: null),

            _ => new BillingEvent(
                stripeEvent.Id,
                stripeEvent.Type,
                BillingEventKind.Unhandled,
                CustomerId: null,
                SubscriptionId: null,
                ClientReferenceUserId: null,
                SubscriptionStatus.None,
                CurrentPeriodEnd: null),
        };
    }

    /// <summary>
    /// The current period end moved from the subscription onto its items in recent
    /// Stripe API versions; read it from the first item when available.
    /// </summary>
    private static DateTimeOffset? ResolvePeriodEnd(StripeSubscription sub)
    {
        var item = sub.Items?.Data?.FirstOrDefault();
        return item is null ? null : new DateTimeOffset(item.CurrentPeriodEnd, TimeSpan.Zero);
    }
}
