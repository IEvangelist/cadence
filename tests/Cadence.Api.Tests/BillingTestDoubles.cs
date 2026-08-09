using System.Security.Cryptography;
using System.Text;
using Cadence.Api.Billing;

namespace Cadence.Api.Tests;

/// <summary>A billing gateway test double that returns canned URLs (no network).</summary>
internal sealed class FakeBillingGateway : IBillingGateway
{
    public string CheckoutUrl { get; init; } = "https://stripe.test/checkout/session";
    public string PortalUrl { get; init; } = "https://stripe.test/portal/session";
    public string CustomerId { get; init; } = "cus_fake_123";

    public CheckoutRequest? LastCheckout { get; private set; }
    public (string CustomerId, string ReturnUrl)? LastPortal { get; private set; }

    public Task<CheckoutSessionResult> CreateCheckoutSessionAsync(CheckoutRequest request, CancellationToken cancellationToken = default)
    {
        LastCheckout = request;
        var customerId = string.IsNullOrWhiteSpace(request.CustomerId) ? CustomerId : request.CustomerId!;
        return Task.FromResult(new CheckoutSessionResult(CheckoutUrl, customerId));
    }

    public Task<string> CreatePortalSessionAsync(string customerId, string returnUrl, CancellationToken cancellationToken = default)
    {
        LastPortal = (customerId, returnUrl);
        return Task.FromResult(PortalUrl);
    }
}

/// <summary>
/// Computes a Stripe <c>Stripe-Signature</c> header for a payload the same way
/// Stripe does (HMAC-SHA256 over <c>{timestamp}.{payload}</c>), so webhook tests
/// can produce valid — and deliberately invalid — signatures without the live API.
/// </summary>
internal static class StripeTestSigner
{
    public static string Sign(string payload, string secret, long? timestamp = null)
    {
        var ts = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{ts}.{payload}"));
        return $"t={ts},v1={Convert.ToHexString(hash).ToLowerInvariant()}";
    }
}
