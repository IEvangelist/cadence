using System.Globalization;
using System.Security.Claims;
using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Cadence.Api.Ai;

/// <summary>
/// Maps the optional server-side AI generation endpoint (<c>POST /api/ai/generate</c>, #140).
/// The route is a <b>drop-in alternative</b> to the on-device generator: same owner-scoped auth
/// as the other endpoints, the same note JSON contract the browser produces, and the #71 daily
/// cap enforced server-side. It is mapped ONLY when <c>Ai:ServerSide:Enabled</c> is true, so with
/// the default-off flag callers get a 404 and nothing about the default experience changes.
/// </summary>
public static class CadenceAiEndpoints
{
    /// <summary>Map <c>/api/ai/generate</c> when the feature flag is enabled; otherwise no-op.</summary>
    public static IEndpointRouteBuilder MapCadenceAi(this IEndpointRouteBuilder app)
    {
        // Gate on the bound options (resolved post-build), the SAME value the service
        // registration is keyed on, so "registered" and "mapped" can never disagree. When the
        // flag is off the route is never mapped, so callers get a 404 and the default
        // (on-device only) experience is entirely unchanged.
        var options = app.ServiceProvider.GetRequiredService<IOptions<AiGenerationOptions>>().Value;
        if (!options.Enabled)
        {
            return app;
        }

        var group = app.MapGroup("/api/ai").WithTags("AI").RequireAuthorization();
        group.MapPost("/generate", GenerateAsync).WithName("GenerateAi");

        return app;
    }

    private static async Task<IResult> GenerateAsync(
        AiGenerateRequest request,
        HttpContext httpContext,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IEntitlementService entitlements,
        AiNoteGenerator generator,
        IAiGenerationCounter counter,
        CancellationToken cancellationToken)
    {
        // Validate the request shape before doing any work: a known action and present params.
        if (request?.Params is null || !AiNoteGenerator.IsKnownAction(request.Action))
        {
            return Results.Problem(
                title: "Invalid request",
                detail: "Provide an 'action' of continue, generate, or harmonize and a 'params' object.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var ownerId = users.GetUserId(principal)!;

        // Availability first: if the local model is not running, say so (503) before touching the
        // daily budget, so an unavailable service never consumes a user's generations.
        if (!generator.IsAvailable)
        {
            return LocalAiUnavailable();
        }

        // Server-authoritative daily cap (#71): read the limit from the tier's entitlements
        // (default 50; -1 means unlimited), resolving the tier from persistence — not the cookie
        // claim — exactly like the stem-separation gate.
        var tier = await ResolveTierAsync(db, ownerId);
        var limit = entitlements.GetEntitlements(tier).AiGenerationsPerDay;
        var capped = limit != Entitlements.Unlimited;
        if (capped)
        {
            var used = await counter.GetTodayAsync(ownerId, cancellationToken);
            if (used >= limit)
            {
                var retryAfter = (int)Math.Ceiling(
                    AiGenerationWindow.UntilNextUtcMidnight(DateTimeOffset.UtcNow).TotalSeconds);
                httpContext.Response.Headers.RetryAfter = retryAfter.ToString(CultureInfo.InvariantCulture);
                return Results.Problem(
                    title: "Daily generation limit reached",
                    detail: $"You have reached the daily limit of {limit} AI generations. Try again tomorrow.",
                    statusCode: StatusCodes.Status429TooManyRequests);
            }
        }

        var result = await generator.GenerateAsync(request, cancellationToken);
        switch (result.Status)
        {
            case AiGenerationStatus.Unavailable:
                return LocalAiUnavailable();

            case AiGenerationStatus.InvalidModelOutput:
                return Results.Problem(
                    title: "Generation failed",
                    detail: "The local model did not return usable notes. Try again.",
                    statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        // Only successful generations count against the cap, so a failed/unavailable attempt
        // never burns budget. (Pre-check + increment-on-success is a soft cap; the counter's
        // atomic increment bounds concurrent overshoot and remains the authoritative tally.)
        if (capped)
        {
            await counter.IncrementTodayAsync(ownerId, cancellationToken);
        }

        return Results.Ok(new AiGenerateResponse(request.Action, result.Notes, result.Label));
    }

    private static IResult LocalAiUnavailable() => Results.Problem(
        title: "AI generation unavailable",
        detail: "Local AI generation is not running. Start the Ollama resource to enable it.",
        statusCode: StatusCodes.Status503ServiceUnavailable);

    private static async Task<SubscriptionTier> ResolveTierAsync(CadenceDbContext db, string ownerId) =>
        await db.Profiles
            .AsNoTracking()
            .Where(p => p.UserId == ownerId)
            .Select(p => (SubscriptionTier?)p.Tier)
            .FirstOrDefaultAsync() ?? SubscriptionTier.Free;
}
