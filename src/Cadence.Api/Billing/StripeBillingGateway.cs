using Microsoft.Extensions.Options;
using Stripe;
using Stripe.BillingPortal;
using Stripe.Checkout;
using System.Diagnostics.CodeAnalysis;
using BillingPortalSessionCreateOptions = Stripe.BillingPortal.SessionCreateOptions;
using BillingPortalSessionService = Stripe.BillingPortal.SessionService;
using CheckoutSessionCreateOptions = Stripe.Checkout.SessionCreateOptions;
using CheckoutSessionService = Stripe.Checkout.SessionService;

namespace Cadence.Api.Billing;

/// <summary>Details needed to start a subscription checkout for a user.</summary>
/// <param name="UserId">The Cadence user id (stamped as <c>client_reference_id</c>).</param>
/// <param name="CustomerId">An existing Stripe customer id to reuse, if any.</param>
/// <param name="CustomerEmail">The user's email, used when creating a customer.</param>
/// <param name="SuccessUrl">Where Stripe returns after a successful checkout.</param>
/// <param name="CancelUrl">Where Stripe returns when the checkout is cancelled.</param>
public sealed record CheckoutRequest(
    string UserId,
    string? CustomerId,
    string? CustomerEmail,
    string SuccessUrl,
    string CancelUrl);

/// <summary>The result of creating a checkout session.</summary>
/// <param name="Url">The hosted Stripe Checkout URL to redirect the user to.</param>
/// <param name="CustomerId">The Stripe customer id used (created if necessary), to persist.</param>
public sealed record CheckoutSessionResult(string Url, string CustomerId);

/// <summary>
/// The billing provider seam for outbound calls (the two operations that hit the
/// live Stripe API). Kept behind an interface so endpoint tests can fake it and
/// never touch the network.
/// </summary>
public interface IBillingGateway
{
    /// <summary>Create a subscription Checkout session and return its URL + customer id.</summary>
    Task<CheckoutSessionResult> CreateCheckoutSessionAsync(CheckoutRequest request, CancellationToken cancellationToken = default);

    /// <summary>Create a Customer Portal session and return its URL.</summary>
    Task<string> CreatePortalSessionAsync(string customerId, string returnUrl, CancellationToken cancellationToken = default);
}

/// <summary>
/// Stripe-backed <see cref="IBillingGateway"/>. Ensures a Stripe customer exists
/// for the user (creating one stamped with the user id when needed) so subsequent
/// subscription webhooks can be resolved back to the user by customer id, then
/// opens a subscription Checkout or Customer Portal session.
/// </summary>
/// <remarks>
/// Excluded from coverage: this is a thin adapter over the live Stripe SDK (a
/// network I/O boundary), faked in tests. The billing logic that carries behavior
/// — webhook verification, status/tier mapping, idempotency, and enforcement — is
/// unit-tested. Mirrors the existing <c>CadenceDbContextFactory</c> exclusion.
/// </remarks>
[ExcludeFromCodeCoverage]
public sealed class StripeBillingGateway(IOptions<BillingOptions> options) : IBillingGateway
{
    private readonly BillingOptions _options = options.Value;

    private IStripeClient Client => new StripeClient(_options.Stripe.SecretKey);

    /// <inheritdoc />
    public async Task<CheckoutSessionResult> CreateCheckoutSessionAsync(
        CheckoutRequest request,
        CancellationToken cancellationToken = default)
    {
        var customerId = request.CustomerId;
        if (string.IsNullOrWhiteSpace(customerId))
        {
            var customers = new CustomerService(Client);
            var customer = await customers.CreateAsync(
                new CustomerCreateOptions
                {
                    Email = request.CustomerEmail,
                    Metadata = new Dictionary<string, string> { ["cadence_user_id"] = request.UserId },
                },
                cancellationToken: cancellationToken);
            customerId = customer.Id;
        }

        var sessions = new CheckoutSessionService(Client);
        var session = await sessions.CreateAsync(
            new CheckoutSessionCreateOptions
            {
                Mode = "subscription",
                Customer = customerId,
                ClientReferenceId = request.UserId,
                SuccessUrl = request.SuccessUrl,
                CancelUrl = request.CancelUrl,
                LineItems =
                [
                    new SessionLineItemOptions { Price = _options.Stripe.PriceId, Quantity = 1 },
                ],
            },
            cancellationToken: cancellationToken);

        return new CheckoutSessionResult(session.Url, customerId!);
    }

    /// <inheritdoc />
    public async Task<string> CreatePortalSessionAsync(
        string customerId,
        string returnUrl,
        CancellationToken cancellationToken = default)
    {
        var portal = new BillingPortalSessionService(Client);
        var session = await portal.CreateAsync(
            new BillingPortalSessionCreateOptions { Customer = customerId, ReturnUrl = returnUrl },
            cancellationToken: cancellationToken);
        return session.Url;
    }
}
