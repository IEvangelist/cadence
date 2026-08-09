using Cadence.Api.Billing;
using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Security.Claims;

namespace Cadence.Api;

/// <summary>
/// Maps the billing + entitlement HTTP endpoints: the current entitlement set,
/// checkout/portal session creation, and the signed Stripe webhook. Enforcement is
/// server-authoritative — tiers are resolved from persistence, never trusted from
/// the client.
/// </summary>
public static class BillingEndpoints
{
    /// <summary>Problem-type URI for a paid-only action attempted on the free tier.</summary>
    public const string UpgradeRequiredType = "https://cadence.app/problems/upgrade-required";

    /// <summary>Map <c>/api/entitlements</c> and <c>/api/billing/*</c>.</summary>
    public static IEndpointRouteBuilder MapCadenceBilling(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/entitlements", GetEntitlementsAsync)
            .WithTags("Billing")
            .RequireAuthorization();

        var billing = app.MapGroup("/api/billing").WithTags("Billing");
        billing.MapPost("/checkout", CreateCheckoutAsync).RequireAuthorization();
        billing.MapPost("/portal", CreatePortalAsync).RequireAuthorization();

        // The webhook is called by Stripe, not the browser: anonymous, verified by signature.
        billing.MapPost("/webhook", HandleWebhookAsync);

        return app;
    }

    private static async Task<IResult> GetEntitlementsAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IEntitlementService entitlements)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var tier = await ResolveTierAsync(db, user.Id);
        var set = entitlements.GetEntitlements(tier);
        return Results.Ok(ToResponse(set));
    }

    private static async Task<IResult> CreateCheckoutAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IBillingGateway gateway,
        BillingOptions options,
        IConfiguration configuration)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        if (!options.IsConfigured)
        {
            return BillingUnavailable();
        }

        var subscription = await GetOrCreateSubscriptionAsync(db, user.Id);
        var webBase = AccountHelpers.WebBaseUrl(configuration);
        var request = new CheckoutRequest(
            user.Id,
            subscription.StripeCustomerId,
            user.Email,
            OrDefault(options.SuccessUrl, $"{webBase}/pricing?checkout=success"),
            OrDefault(options.CancelUrl, $"{webBase}/pricing?checkout=cancel"));

        var result = await gateway.CreateCheckoutSessionAsync(request);

        subscription.StripeCustomerId = result.CustomerId;
        subscription.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();

        return Results.Ok(new BillingUrlResponse(result.Url));
    }

    private static async Task<IResult> CreatePortalAsync(
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IBillingGateway gateway,
        BillingOptions options,
        IConfiguration configuration)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null)
        {
            return Results.Unauthorized();
        }

        var subscription = await db.Subscriptions
            .FirstOrDefaultAsync(s => s.UserId == user.Id);

        // The portal manages an existing billing relationship. A user who has never
        // subscribed (no Stripe customer) has nothing to manage: paid-only → 402.
        if (subscription?.StripeCustomerId is not { Length: > 0 } customerId)
        {
            return UpgradeRequired("The customer portal is available after you subscribe to a paid plan.");
        }

        if (!options.IsConfigured)
        {
            return BillingUnavailable();
        }

        var webBase = AccountHelpers.WebBaseUrl(configuration);
        var url = await gateway.CreatePortalSessionAsync(
            customerId,
            OrDefault(options.PortalReturnUrl, $"{webBase}/pricing"));

        return Results.Ok(new BillingUrlResponse(url));
    }

    private static async Task<IResult> HandleWebhookAsync(
        HttpRequest request,
        IStripeWebhookParser parser,
        SubscriptionService subscriptions,
        BillingOptions options)
    {
        if (!options.CanVerifyWebhooks)
        {
            // Without a signing secret we cannot trust the payload — refuse it.
            return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
        }

        using var reader = new StreamReader(request.Body);
        var payload = await reader.ReadToEndAsync();
        var signature = request.Headers["Stripe-Signature"].ToString();

        BillingEvent billingEvent;
        try
        {
            billingEvent = parser.Parse(payload, signature);
        }
        catch (Stripe.StripeException)
        {
            return Results.BadRequest(new { error = "Invalid webhook signature." });
        }

        await subscriptions.ApplyAsync(billingEvent);
        return Results.Ok();
    }

    private static async Task<SubscriptionTier> ResolveTierAsync(CadenceDbContext db, string userId) =>
        await db.Profiles
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => (SubscriptionTier?)p.Tier)
            .FirstOrDefaultAsync() ?? SubscriptionTier.Free;

    private static async Task<Subscription> GetOrCreateSubscriptionAsync(CadenceDbContext db, string userId)
    {
        var subscription = await db.Subscriptions.FirstOrDefaultAsync(s => s.UserId == userId);
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
        db.Subscriptions.Add(subscription);
        return subscription;
    }

    private static IResult UpgradeRequired(string detail) =>
        Results.Problem(
            title: "Upgrade required",
            detail: detail,
            statusCode: StatusCodes.Status402PaymentRequired,
            type: UpgradeRequiredType);

    private static string OrDefault(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value;

    private static IResult BillingUnavailable() =>
        Results.Problem(
            title: "Billing unavailable",
            detail: "Billing is not configured on this server.",
            statusCode: StatusCodes.Status503ServiceUnavailable);

    private static EntitlementsResponse ToResponse(Entitlements set) =>
        new(
            set.Tier.ToString(),
            set.WatermarkExports,
            set.MaxProjects,
            set.AiGenerationsPerDay,
            set.AdvancedFormats,
            set.StemSeparation,
            set.CollaborationSeats);
}
