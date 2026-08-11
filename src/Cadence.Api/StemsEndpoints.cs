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

        // Defense in depth: the Content-Type allow-list above is only a cheap first
        // gate — a client can send arbitrary bytes under an audio/* header. Sniff the
        // actual leading bytes so the payload must really be one of the audio
        // containers the pipeline understands; a spoofed type is rejected as 415.
        if (!LooksLikeAllowedAudio(bytes))
        {
            return Results.Problem(
                title: "Unsupported media type",
                detail: "The upload's contents are not a recognized audio file (expected WAV, MP3, FLAC, OGG, or MP4/AAC).",
                statusCode: StatusCodes.Status415UnsupportedMediaType);
        }

        // A payload that presents as a RIFF/WAVE container must be a parseable PCM
        // WAV: a malformed one is a client error (400), never an unhandled 500 from
        // the header scan. For a decodable WAV we also know the exact length and can
        // enforce the duration cap; other formats are governed by the size cap and
        // decoded by the worker.
        if (LooksLikeRiffWave(bytes))
        {
            if (!WavAudio.TryGetDurationSeconds(bytes, out var seconds))
            {
                return Results.Problem(
                    title: "Malformed audio",
                    detail: "The WAV upload could not be parsed.",
                    statusCode: StatusCodes.Status400BadRequest);
            }

            if (seconds > options.MaxDurationSeconds)
            {
                return Results.Problem(
                    title: "Audio too long",
                    detail: $"The maximum mix duration is {options.MaxDurationSeconds} seconds.",
                    statusCode: StatusCodes.Status413PayloadTooLarge);
            }
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

    // A minimal RIFF/WAVE signature check (12-byte header). Used to decide whether an
    // upload claims to be a WAV, so an unparseable one can be rejected as 400 instead
    // of silently stored or surfaced as a 500 from the header scan.
    private static bool LooksLikeRiffWave(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= 12 &&
        bytes[..4].SequenceEqual("RIFF"u8) &&
        bytes.Slice(8, 4).SequenceEqual("WAVE"u8);

    // Magic-byte sniff (defense in depth for the Content-Type gate): does the header
    // begin with one of the audio container signatures the pipeline accepts? Only the
    // leading bytes are inspected — never the whole upload. Detects WAV (RIFF/WAVE),
    // FLAC (fLaC), OGG (OggS), MP3 (ID3v2 tag or an MPEG/ADTS frame sync), and the
    // ISO-BMFF ftyp box that fronts MP4/M4A/AAC.
    private static bool LooksLikeAllowedAudio(ReadOnlySpan<byte> header)
    {
        // WAV: a RIFF container tagged WAVE.
        if (LooksLikeRiffWave(header))
        {
            return true;
        }

        // FLAC ("fLaC") and OGG ("OggS") stream markers.
        if (header.Length >= 4 &&
            (header[..4].SequenceEqual("fLaC"u8) || header[..4].SequenceEqual("OggS"u8)))
        {
            return true;
        }

        // MP3 with a leading ID3v2 tag.
        if (header.Length >= 3 && header[..3].SequenceEqual("ID3"u8))
        {
            return true;
        }

        // Raw MPEG/ADTS frame sync: 11 set bits (0xFF followed by 0xExx). Covers
        // tagless MP3 and ADTS-framed AAC.
        if (header.Length >= 2 && header[0] == 0xFF && (header[1] & 0xE0) == 0xE0)
        {
            return true;
        }

        // MP4 / M4A / AAC: an ISO base-media "ftyp" box (4-byte size, then the tag).
        if (header.Length >= 8 && header.Slice(4, 4).SequenceEqual("ftyp"u8))
        {
            return true;
        }

        return false;
    }

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
