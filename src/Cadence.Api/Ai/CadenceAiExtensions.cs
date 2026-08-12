using Microsoft.Extensions.Hosting;

namespace Cadence.Api.Ai;

/// <summary>
/// Registers the optional, local-only server-side AI generation feature (#140). The feature is
/// gated on <c>Ai:ServerSide:Enabled</c> (default OFF): when disabled the endpoint is not mapped
/// (<see cref="CadenceAiEndpoints.MapCadenceAi"/> returns 404) and no Ollama client is resolved,
/// so the default on-device experience is completely unchanged and nothing reaches out to Ollama.
/// <para>
/// The daily-cap counter and the note generator are registered <em>unconditionally</em> — they
/// are the endpoint handler's dependencies, so they must always be resolvable for the route to be
/// built, and they stay entirely inert while the route is unmapped. Only the outbound Ollama
/// <c>IChatClient</c> is conditional: it is wired solely when the feature is enabled and the
/// referenced model's connection string is present (a developer started the explicit-start Ollama
/// resource). Mapping is gated on the bound options, so the "registered" and "mapped" decisions
/// read the same post-build value and can never diverge.
/// </para>
/// </summary>
public static class CadenceAiExtensions
{
    /// <summary>Register the server-side AI services (the endpoint is mapped separately, when enabled).</summary>
    public static IHostApplicationBuilder AddCadenceAi(this IHostApplicationBuilder builder)
    {
        builder.Services.Configure<AiGenerationOptions>(
            builder.Configuration.GetSection(AiGenerationOptions.SectionName));

        var enabled = builder.Configuration.GetValue($"{AiGenerationOptions.SectionName}:Enabled", false);
        var connectionName =
            builder.Configuration[$"{AiGenerationOptions.SectionName}:ConnectionName"] ?? "ollama-model";

        // Daily-cap counter. Presence of the "redis" connection string (injected by the
        // AppHost's .WithReference(redis)) switches it from in-process to distributed, exactly
        // like the auth rate limiters — so it is GLOBAL across Azure Container Apps replicas in
        // production and an isolated in-memory counter for single-node dev and unit tests. It is
        // registered regardless of the flag so the endpoint's dependencies always resolve, and
        // stays inert until the route is mapped (which only happens when the feature is enabled).
        var redisConnectionString = builder.Configuration.GetConnectionString("redis");
        if (!string.IsNullOrWhiteSpace(redisConnectionString))
        {
            // Registers IConnectionMultiplexer wired to the "redis" resource. Idempotent: the
            // rate limiter registers the same client, and the Aspire integration uses TryAdd.
            builder.AddRedisClient("redis");
            builder.Services.AddSingleton<IAiGenerationCounter, RedisAiGenerationCounter>();
        }
        else
        {
            builder.Services.AddSingleton<IAiGenerationCounter, InMemoryAiGenerationCounter>();
        }

        builder.Services.AddScoped<AiNoteGenerator>();

        // Reach out to Ollama ONLY when the feature is enabled AND a developer has started the
        // explicit-start model (its connection string is present). In CI and a normal F5 the
        // connection is absent, so no client is registered and the endpoint answers 503 (never a
        // startup failure). The generator resolves the client optionally, so a missing one is
        // fine; tests inject a fake IChatClient instead, so this real wiring never runs there.
        if (enabled && !string.IsNullOrWhiteSpace(builder.Configuration.GetConnectionString(connectionName)))
        {
            builder.AddOllamaApiClient(connectionName).AddChatClient();
        }

        return builder;
    }
}
