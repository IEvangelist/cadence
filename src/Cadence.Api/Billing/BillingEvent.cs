using Cadence.Data.Entities;

namespace Cadence.Api.Billing;

/// <summary>
/// The billing-relevant shape a Stripe webhook event is normalized into, so the
/// rest of the system never depends on Stripe SDK types. Produced by
/// <see cref="IStripeWebhookParser"/> and consumed by <see cref="SubscriptionService"/>.
/// </summary>
/// <param name="Id">Stripe event id (<c>evt_…</c>), used for idempotency.</param>
/// <param name="Type">Raw Stripe event type (e.g. <c>customer.subscription.updated</c>).</param>
/// <param name="Kind">The normalized category this event maps to.</param>
/// <param name="CustomerId">Stripe customer id the event concerns, when present.</param>
/// <param name="SubscriptionId">Stripe subscription id, when present.</param>
/// <param name="ClientReferenceUserId">
/// The Cadence user id carried on a checkout session's <c>client_reference_id</c>,
/// used to link a Stripe customer to a user.
/// </param>
/// <param name="Status">The subscription status carried by subscription events.</param>
/// <param name="CurrentPeriodEnd">End of the current paid period, when present.</param>
public sealed record BillingEvent(
    string Id,
    string Type,
    BillingEventKind Kind,
    string? CustomerId,
    string? SubscriptionId,
    string? ClientReferenceUserId,
    SubscriptionStatus Status,
    DateTimeOffset? CurrentPeriodEnd);

/// <summary>The normalized category of a <see cref="BillingEvent"/>.</summary>
public enum BillingEventKind
{
    /// <summary>An event Cadence does not act on (recorded for idempotency, then ignored).</summary>
    Unhandled = 0,

    /// <summary>A checkout completed — links a Stripe customer/subscription to a user.</summary>
    CheckoutCompleted = 1,

    /// <summary>A subscription was created or updated — carries the authoritative status.</summary>
    SubscriptionChanged = 2,

    /// <summary>A subscription was deleted/ended — reverts the user to free.</summary>
    SubscriptionDeleted = 3,

    /// <summary>An invoice payment succeeded — informational only; not authoritative for tiering (upgrades come from <c>customer.subscription.*</c>).</summary>
    PaymentSucceeded = 4,

    /// <summary>An invoice payment failed — marks the subscription past-due.</summary>
    PaymentFailed = 5,
}

/// <summary>Maps Stripe's string enums to Cadence's typed ones.</summary>
public static class StripeStatusMap
{
    /// <summary>Map a Stripe subscription <c>status</c> string to a <see cref="SubscriptionStatus"/>.</summary>
    public static SubscriptionStatus ToSubscriptionStatus(string? stripeStatus) => stripeStatus switch
    {
        "active" => SubscriptionStatus.Active,
        "trialing" => SubscriptionStatus.Trialing,
        "past_due" => SubscriptionStatus.PastDue,
        "canceled" => SubscriptionStatus.Canceled,
        "unpaid" => SubscriptionStatus.Unpaid,
        "incomplete" or "incomplete_expired" => SubscriptionStatus.Incomplete,
        _ => SubscriptionStatus.None,
    };

    /// <summary>Map a Stripe event <c>type</c> to a normalized <see cref="BillingEventKind"/>.</summary>
    public static BillingEventKind ToEventKind(string? stripeType) => stripeType switch
    {
        "checkout.session.completed" => BillingEventKind.CheckoutCompleted,
        "customer.subscription.created" or "customer.subscription.updated" => BillingEventKind.SubscriptionChanged,
        "customer.subscription.deleted" => BillingEventKind.SubscriptionDeleted,
        "invoice.payment_succeeded" or "invoice.paid" => BillingEventKind.PaymentSucceeded,
        "invoice.payment_failed" => BillingEventKind.PaymentFailed,
        _ => BillingEventKind.Unhandled,
    };
}
