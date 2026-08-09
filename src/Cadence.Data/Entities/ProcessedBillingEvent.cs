namespace Cadence.Data.Entities;

/// <summary>
/// Idempotency ledger for processed Stripe webhook events. Stripe may deliver the
/// same event more than once; recording each event id the first time it is applied
/// lets the webhook handler skip duplicates so replays cause exactly one state
/// change. The event id is the primary key — a second insert with the same id fails
/// (or is detected first), guaranteeing at-most-once application.
/// </summary>
public sealed class ProcessedBillingEvent
{
    /// <summary>Stripe event id (<c>evt_…</c>). Primary key.</summary>
    public string EventId { get; set; } = string.Empty;

    /// <summary>Stripe event type (e.g. <c>customer.subscription.updated</c>), for diagnostics.</summary>
    public string EventType { get; set; } = string.Empty;

    /// <summary>When the event was first processed (UTC).</summary>
    public DateTimeOffset ProcessedAt { get; set; }
}
