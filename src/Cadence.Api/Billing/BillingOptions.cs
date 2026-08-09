namespace Cadence.Api.Billing;

/// <summary>
/// Configuration for the Stripe billing provider, bound from the <c>Billing</c>
/// section. All secrets are supplied out-of-band (user-secrets / Aspire params);
/// the committed defaults are empty placeholders. When <see cref="IsConfigured"/>
/// is <see langword="false"/> the checkout/portal endpoints report that billing is
/// unavailable rather than calling Stripe — mirroring how the OAuth providers are
/// opt-in.
/// </summary>
public sealed class BillingOptions
{
    /// <summary>Configuration section these options bind from.</summary>
    public const string SectionName = "Billing";

    /// <summary>Stripe settings (secret/publishable/webhook keys, price id).</summary>
    public StripeOptions Stripe { get; set; } = new();

    /// <summary>Absolute URL Stripe returns to after a successful checkout.</summary>
    public string? SuccessUrl { get; set; }

    /// <summary>Absolute URL Stripe returns to when a checkout is cancelled.</summary>
    public string? CancelUrl { get; set; }

    /// <summary>Absolute URL the customer portal returns to.</summary>
    public string? PortalReturnUrl { get; set; }

    /// <summary>
    /// True when the minimum Stripe settings needed to start a subscription
    /// checkout are present (a secret key and a price to subscribe to).
    /// </summary>
    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(Stripe.SecretKey) &&
        !string.IsNullOrWhiteSpace(Stripe.PriceId);

    /// <summary>True when webhook signatures can be verified.</summary>
    public bool CanVerifyWebhooks => !string.IsNullOrWhiteSpace(Stripe.WebhookSecret);
}

/// <summary>Stripe-specific credentials and identifiers.</summary>
public sealed class StripeOptions
{
    /// <summary>Secret API key (<c>sk_test_…</c>). Never committed.</summary>
    public string SecretKey { get; set; } = string.Empty;

    /// <summary>Publishable key (<c>pk_test_…</c>), surfaced to the client if needed.</summary>
    public string PublishableKey { get; set; } = string.Empty;

    /// <summary>Webhook signing secret (<c>whsec_…</c>) used to verify events.</summary>
    public string WebhookSecret { get; set; } = string.Empty;

    /// <summary>Price id (<c>price_…</c>) of the paid (Pro) plan.</summary>
    public string PriceId { get; set; } = string.Empty;
}
