using Microsoft.Extensions.Configuration;

var builder = DistributedApplication.CreateBuilder(args);

// Relational store for projects, users, and metadata.
var postgres = builder.AddPostgres("postgres");
var cadenceDb = postgres.AddDatabase("cadencedb");

// Presence, caching, and rate-limiting.
var redis = builder.AddRedis("redis");

// Audio/asset blob storage, backed by the Azurite emulator in development.
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var blobs = storage.AddBlobs("blobs");

builder.AddProject<Projects.Cadence_Api>("api")
    .WithReference(cadenceDb)
    .WaitFor(cadenceDb)
    .WithReference(redis)
    .WaitFor(redis)
    .WithReference(blobs)
    .WaitFor(blobs)
    .WithBillingConfiguration(builder.Configuration);

// Background stem-separation worker: consumes queued jobs, runs the separation
// engine, and writes labeled stems back to Blob storage. It shares the Postgres
// and Blob resources with the API and needs no inbound traffic of its own.
builder.AddProject<Projects.Cadence_SeparationWorker>("separation")
    .WithReference(cadenceDb)
    .WaitFor(cadenceDb)
    .WithReference(blobs)
    .WaitFor(blobs);

builder.Build().Run();

file static class BillingConfigurationExtensions
{
    // Stripe billing settings are supplied out-of-band (AppHost user-secrets /
    // deployment params) and forwarded to the API only when present, so nothing is
    // required for a local run and no secrets are ever committed. The integration
    // tests inject a webhook secret via command-line configuration to drive a
    // signed webhook end-to-end.
    private static readonly string[] BillingKeys =
    [
        "Billing:Stripe:SecretKey",
        "Billing:Stripe:PublishableKey",
        "Billing:Stripe:WebhookSecret",
        "Billing:Stripe:PriceId",
        "Billing:SuccessUrl",
        "Billing:CancelUrl",
        "Billing:PortalReturnUrl",
    ];

    public static IResourceBuilder<ProjectResource> WithBillingConfiguration(
        this IResourceBuilder<ProjectResource> api,
        IConfiguration configuration)
    {
        foreach (var key in BillingKeys)
        {
            var value = configuration[key];
            if (!string.IsNullOrEmpty(value))
            {
                api.WithEnvironment(key.Replace(":", "__"), value);
            }
        }

        return api;
    }
}
