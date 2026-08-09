using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Cadence.Data.Stems;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace Cadence.Api;

/// <summary>
/// Maps the stem-separation API (<c>/api/stems</c>). Every route is authorized and
/// owner-scoped: a job or stem belonging to another user is indistinguishable from
/// a missing one (404), never leaked. Creating a job is gated on the server-
/// authoritative <see cref="Entitlements.StemSeparation"/> flag (free tier → 402),
/// mirroring the project-cap gate on <see cref="ProjectsEndpoints"/>.
/// </summary>
public static class StemsEndpoints
{
    /// <summary>Map <c>/api/stems</c> owner-scoped job + stem endpoints.</summary>
    public static IEndpointRouteBuilder MapCadenceStems(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/stems").WithTags("Stems").RequireAuthorization();

        group.MapPost("/jobs", CreateJobAsync)
            .WithName("CreateStemJob")
            // The mix is streamed as the raw request body; disable antiforgery so the
            // JSON-cookie SPA can upload without a form token (auth is still required).
            .DisableAntiforgery();
        group.MapGet("/jobs", ListJobsAsync);
        group.MapGet("/jobs/{id}", GetJobAsync);
        group.MapGet("/jobs/{id}/stems/{label}", DownloadStemAsync);

        return app;
    }

    private static async Task<IResult> CreateJobAsync(
        HttpRequest request,
        string? name,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IEntitlementService entitlements,
        IStemStorage storage,
        StemOptions options,
        CancellationToken cancellationToken)
    {
        var ownerId = users.GetUserId(principal)!;

        // Server-authoritative entitlement gate: resolve the tier from the profile
        // (kept fresh by billing webhooks), not the cookie claim. Free tier → 402
        // with a typed problem body pointing at the upgrade.
        var tier = await ResolveTierAsync(db, ownerId);
        if (!entitlements.GetEntitlements(tier).StemSeparation)
        {
            return Results.Problem(
                title: "Upgrade required",
                detail: $"The {tier} plan does not include stem separation. Upgrade to Pro to separate stems.",
                statusCode: StatusCodes.Status402PaymentRequired,
                type: BillingEndpoints.UpgradeRequiredType);
        }

        var contentType = request.ContentType;
        if (!options.IsContentTypeAllowed(contentType))
        {
            return Results.Problem(
                title: "Unsupported media type",
                detail: "Upload an audio file (e.g. WAV, MP3, FLAC, OGG).",
                statusCode: StatusCodes.Status415UnsupportedMediaType);
        }

        // Fast pre-check on the declared length, then a hard cap while reading so a
        // lying/absent Content-Length can't blow past the limit.
        if (request.ContentLength is { } declared && declared > options.MaxUploadBytes)
        {
            return TooLarge(options);
        }

        var bytes = await ReadCappedAsync(request.Body, options.MaxUploadBytes, cancellationToken);
        if (bytes is null)
        {
            return TooLarge(options);
        }

        if (bytes.Length == 0)
        {
            return Results.Problem(
                title: "Empty upload",
                detail: "The request body contained no audio.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        // Duration cap (best-effort): for a decodable PCM WAV we know the exact
        // length; other formats are governed by the size cap and the worker.
        if (WavAudio.TryGetDurationSeconds(bytes, out var seconds) && seconds > options.MaxDurationSeconds)
        {
            return Results.Problem(
                title: "Audio too long",
                detail: $"The maximum mix duration is {options.MaxDurationSeconds} seconds.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var id = Guid.NewGuid().ToString("N");
        using var mixStream = new MemoryStream(bytes, writable: false);
        var mixPath = await storage.SaveMixAsync(ownerId, id, contentType!, mixStream, cancellationToken);

        var now = DateTimeOffset.UtcNow;
        var job = new SeparationJob
        {
            Id = id,
            OwnerId = ownerId,
            Status = JobStatus.Queued,
            OriginalFileName = SanitizeFileName(name),
            ContentType = contentType!,
            SizeBytes = bytes.Length,
            MixBlobPath = mixPath,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.SeparationJobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Accepted($"/api/stems/jobs/{id}", ToDetail(job));
    }

    private static async Task<IResult> ListJobsAsync(ClaimsPrincipal principal, UserManager<ApplicationUser> users, CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var jobs = await db.SeparationJobs
            .AsNoTracking()
            .Where(j => j.OwnerId == ownerId)
            .Select(j => new StemJobSummary(
                j.Id, j.Status.ToString(), j.OriginalFileName, j.SizeBytes, j.CreatedAt, j.UpdatedAt, j.CompletedAt))
            .ToListAsync();

        // Newest-first in memory: the list is small and SQLite (unit tests) cannot
        // ORDER BY a DateTimeOffset.
        return Results.Ok(jobs.OrderByDescending(j => j.CreatedAt).ToList());
    }

    private static async Task<IResult> GetJobAsync(string id, ClaimsPrincipal principal, UserManager<ApplicationUser> users, CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var job = await db.SeparationJobs
            .AsNoTracking()
            .Include(j => j.Stems)
            .FirstOrDefaultAsync(j => j.Id == id && j.OwnerId == ownerId);

        return job is null ? Results.NotFound() : Results.Ok(ToDetail(job));
    }

    private static async Task<IResult> DownloadStemAsync(
        string id,
        string label,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IStemStorage storage,
        CancellationToken cancellationToken)
    {
        var ownerId = users.GetUserId(principal)!;
        if (!StemCatalog.TryParse(label, out var stemLabel))
        {
            return Results.NotFound();
        }

        var stem = await db.SeparationStems
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.OwnerId == ownerId && s.JobId == id && s.Label == stemLabel);
        if (stem is null)
        {
            return Results.NotFound();
        }

        var blob = await storage.OpenReadAsync(stem.BlobPath, cancellationToken);
        if (blob is null)
        {
            return Results.NotFound();
        }

        return Results.File(blob.Content, "audio/wav", $"{StemCatalog.Slug(stemLabel)}.wav");
    }

    private static async Task<SubscriptionTier> ResolveTierAsync(CadenceDbContext db, string ownerId) =>
        await db.Profiles
            .AsNoTracking()
            .Where(p => p.UserId == ownerId)
            .Select(p => (SubscriptionTier?)p.Tier)
            .FirstOrDefaultAsync() ?? SubscriptionTier.Free;

    private static async Task<byte[]?> ReadCappedAsync(Stream body, long cap, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > cap)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private static string SanitizeFileName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return "mix";
        }

        // Strip any directory components a client might smuggle in, then bound length.
        var fileName = Path.GetFileName(name.Trim());
        return string.IsNullOrWhiteSpace(fileName) ? "mix" : fileName[..Math.Min(fileName.Length, 200)];
    }

    private static IResult TooLarge(StemOptions options) => Results.Problem(
        title: "Upload too large",
        detail: $"The maximum upload size is {options.MaxUploadBytes} bytes.",
        statusCode: StatusCodes.Status413PayloadTooLarge);

    private static StemJobDetail ToDetail(SeparationJob job) => new(
        job.Id,
        job.Status.ToString(),
        job.OriginalFileName,
        job.ContentType,
        job.SizeBytes,
        job.CreatedAt,
        job.UpdatedAt,
        job.CompletedAt,
        job.ErrorMessage,
        job.Stems
            .OrderBy(s => (int)s.Label)
            .Select(s => new StemInfo(
                StemCatalog.Slug(s.Label),
                s.SizeBytes,
                $"/api/stems/jobs/{job.Id}/stems/{StemCatalog.Slug(s.Label)}"))
            .ToList());
}
