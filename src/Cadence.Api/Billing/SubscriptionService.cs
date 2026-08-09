using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Cadence.Api.Billing;

/// <summary>
/// Applies normalized <see cref="BillingEvent"/>s to the durable, owner-scoped
/// subscription record and mirrors the resulting tier onto the user's profile
/// (the field the entitlement claim and profile API read). Application is
/// idempotent: each Stripe event id is recorded once, so redeliveries of the same
/// event cause exactly one state change.
/// </summary>
public sealed class SubscriptionService(CadenceDbContext db)
{
    private readonly CadenceDbContext _db = db;

    /// <summary>
    /// Apply an event idempotently. Returns <see langword="true"/> when the event
    /// was applied for the first time, <see langword="false"/> when it was a
    /// duplicate that had already been processed.
    /// </summary>
    public async Task<bool> ApplyAsync(BillingEvent billingEvent, CancellationToken cancellationToken = default)
    {
        var alreadyProcessed = await _db.ProcessedBillingEvents
            .AnyAsync(e => e.EventId == billingEvent.Id, cancellationToken);
        if (alreadyProcessed)
        {
            return false;
        }

        await ApplyCoreAsync(billingEvent, cancellationToken);

        _db.ProcessedBillingEvents.Add(new ProcessedBillingEvent
        {
            EventId = billingEvent.Id,
            EventType = billingEvent.Type,
            ProcessedAt = DateTimeOffset.UtcNow,
        });
        await _db.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task ApplyCoreAsync(BillingEvent billingEvent, CancellationToken cancellationToken)
    {
        switch (billingEvent.Kind)
        {
            case BillingEventKind.CheckoutCompleted:
                await LinkCustomerAsync(billingEvent, cancellationToken);
                break;

            case BillingEventKind.SubscriptionChanged:
                await UpdateStatusAsync(billingEvent.CustomerId, billingEvent.Status,
                    billingEvent.SubscriptionId, billingEvent.CurrentPeriodEnd, cancellationToken);
                break;

            case BillingEventKind.SubscriptionDeleted:
                await UpdateStatusAsync(billingEvent.CustomerId, SubscriptionStatus.Canceled,
                    billingEvent.SubscriptionId, billingEvent.CurrentPeriodEnd, cancellationToken);
                break;

            case BillingEventKind.PaymentSucceeded:
                // Invoice payment-succeeded is a SECONDARY signal: Stripe does not
                // guarantee its ordering and retries it for ~3 days, so a stale
                // one redelivered after a customer.subscription.deleted (or a
                // past-due) could otherwise flip a non-paying user back to
                // Active -> Pro. It is therefore NOT authoritative for granting a
                // tier — upgrades come solely from the customer.subscription.*
                // lifecycle events, which fire for every activation (created,
                // trial->active, past_due->active recovery, reactivation). The
                // event is still recorded in the idempotency ledger by ApplyAsync.
                // (Payment-failed below stays fail-closed: a downgrade is always
                // safe to apply, only upgrades must be gated on the authoritative
                // source.)
                break;

            case BillingEventKind.PaymentFailed:
                await UpdateStatusAsync(billingEvent.CustomerId, SubscriptionStatus.PastDue,
                    subscriptionId: null, currentPeriodEnd: null, cancellationToken);
                break;

            case BillingEventKind.Unhandled:
            default:
                break;
        }
    }

    /// <summary>
    /// Link a Stripe customer/subscription to a user from a completed checkout. The
    /// user is identified by the checkout's client_reference_id; tier is left to the
    /// subscription lifecycle events that carry the authoritative status.
    /// </summary>
    private async Task LinkCustomerAsync(BillingEvent billingEvent, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(billingEvent.ClientReferenceUserId))
        {
            return;
        }

        var subscription = await GetOrCreateAsync(billingEvent.ClientReferenceUserId, cancellationToken);
        if (!string.IsNullOrWhiteSpace(billingEvent.CustomerId))
        {
            subscription.StripeCustomerId = billingEvent.CustomerId;
        }

        if (!string.IsNullOrWhiteSpace(billingEvent.SubscriptionId))
        {
            subscription.StripeSubscriptionId = billingEvent.SubscriptionId;
        }

        subscription.UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Apply a status transition to the subscription owned by the given Stripe
    /// customer, deriving the tier from the status and mirroring it onto the profile.
    /// </summary>
    private async Task UpdateStatusAsync(
        string? customerId,
        SubscriptionStatus status,
        string? subscriptionId,
        DateTimeOffset? currentPeriodEnd,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(customerId))
        {
            return;
        }

        var subscription = await _db.Subscriptions
            .FirstOrDefaultAsync(s => s.StripeCustomerId == customerId, cancellationToken);
        if (subscription is null)
        {
            // Customer not linked to any user yet — nothing to update.
            return;
        }

        var tier = status.ToTier();
        subscription.Status = status;
        subscription.Tier = tier;
        if (!string.IsNullOrWhiteSpace(subscriptionId))
        {
            subscription.StripeSubscriptionId = subscriptionId;
        }

        if (currentPeriodEnd is not null)
        {
            subscription.CurrentPeriodEnd = currentPeriodEnd;
        }

        subscription.UpdatedAt = DateTimeOffset.UtcNow;

        await MirrorTierToProfileAsync(subscription.UserId, tier, cancellationToken);
    }

    private async Task<Subscription> GetOrCreateAsync(string userId, CancellationToken cancellationToken)
    {
        var subscription = await _db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);
        if (subscription is not null)
        {
            return subscription;
        }

        var now = DateTimeOffset.UtcNow;
        subscription = new Subscription
        {
            UserId = userId,
            Status = SubscriptionStatus.None,
            Tier = SubscriptionTier.Free,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _db.Subscriptions.Add(subscription);
        return subscription;
    }

    private async Task MirrorTierToProfileAsync(string userId, SubscriptionTier tier, CancellationToken cancellationToken)
    {
        var profile = await _db.Profiles.FirstOrDefaultAsync(p => p.UserId == userId, cancellationToken);
        if (profile is null)
        {
            return;
        }

        if (profile.Tier != tier)
        {
            profile.Tier = tier;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
        }
    }
}
