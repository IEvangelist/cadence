using Cadence.Api.Billing;
using Cadence.Data.Entitlements;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Cadence.Api;

/// <summary>
/// Registers the billing + entitlement services: the config-bound entitlement
/// catalog, the Stripe gateway and webhook parser (behind seams), and the
/// idempotent subscription applier.
/// </summary>
public static class CadenceBillingExtensions
{
    /// <summary>Register entitlement options and the Stripe billing seams.</summary>
    public static IHostApplicationBuilder AddCadenceBilling(this IHostApplicationBuilder builder)
    {
        var services = builder.Services;

        // Entitlement catalog: bound from Billing:Entitlements, generous defaults
        // preserved for any key absent from configuration.
        services.Configure<EntitlementOptions>(
            builder.Configuration.GetSection(EntitlementOptions.SectionName));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<EntitlementOptions>>().Value);

        // Stripe / billing configuration (placeholders committed; secrets out-of-band).
        services.Configure<BillingOptions>(
            builder.Configuration.GetSection(BillingOptions.SectionName));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<BillingOptions>>().Value);

        services.AddSingleton<IStripeWebhookParser, StripeWebhookParser>();
        services.AddSingleton<IBillingGateway, StripeBillingGateway>();
        services.AddScoped<SubscriptionService>();

        return builder;
    }
}
