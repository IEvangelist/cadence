using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Entitlements;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace Cadence.Api;

/// <summary>
/// Maps the Projects CRUD API. Every route is authorized and scoped to the
/// signed-in owner: a user can only see or mutate their own projects, and a
/// project belonging to another user is indistinguishable from a missing one
/// (404) to avoid leaking existence.
/// </summary>
public static class ProjectsEndpoints
{
    /// <summary>Map <c>/api/projects</c> owner-scoped CRUD endpoints.</summary>
    public static IEndpointRouteBuilder MapCadenceProjects(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/projects").WithTags("Projects").RequireAuthorization();

        group.MapGet("/", ListAsync);
        group.MapPost("/", CreateAsync);
        group.MapGet("/{id}", GetAsync);
        group.MapPut("/{id}", UpdateAsync);
        group.MapDelete("/{id}", DeleteAsync);

        return app;
    }

    private static async Task<IResult> ListAsync(ClaimsPrincipal principal, UserManager<ApplicationUser> users, CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var projects = await db.Projects
            .AsNoTracking()
            .Where(p => p.OwnerId == ownerId)
            .Select(p => new ProjectSummary(p.Id, p.Name, p.SchemaVersion, p.CreatedAt, p.UpdatedAt))
            .ToListAsync();

        // Order newest-first in memory: a user's own project list is small, and
        // this avoids a provider-specific ORDER BY on DateTimeOffset (unsupported
        // by SQLite, which backs the unit tests).
        var ordered = projects.OrderByDescending(p => p.UpdatedAt).ToList();
        return Results.Ok(ordered);
    }

    private static async Task<IResult> CreateAsync(
        SaveProjectRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        IEntitlementService entitlements)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["name"] = ["Project name is required."],
            });
        }

        var ownerId = users.GetUserId(principal)!;

        // Server-authoritative entitlement gate. Resolve the tier from the profile
        // (kept fresh by billing webhooks), not the cookie claim, then enforce the
        // per-tier project cap. Over-limit free users get 402 Payment Required with
        // a typed problem body pointing at the upgrade.
        var tier = await db.Profiles
            .AsNoTracking()
            .Where(p => p.UserId == ownerId)
            .Select(p => (SubscriptionTier?)p.Tier)
            .FirstOrDefaultAsync() ?? SubscriptionTier.Free;
        var entitlement = entitlements.GetEntitlements(tier);
        var projectCount = await db.Projects.CountAsync(p => p.OwnerId == ownerId);
        if (!entitlement.AllowsProjectCount(projectCount))
        {
            return Results.Problem(
                title: "Upgrade required",
                detail: $"The {tier} plan allows up to {entitlement.MaxProjects} projects. Upgrade to Pro for unlimited projects.",
                statusCode: StatusCodes.Status402PaymentRequired,
                type: BillingEndpoints.UpgradeRequiredType);
        }

        var id = string.IsNullOrWhiteSpace(request.Id) ? Guid.NewGuid().ToString("N") : request.Id!;

        // Owner-scoped existence check: ids are unique per user (composite key), so
        // this neither leaks the existence of another user's project nor lets a
        // client squat a global id.
        if (await db.Projects.AnyAsync(p => p.OwnerId == ownerId && p.Id == id))
        {
            return Results.Conflict(new { error = $"A project with id '{id}' already exists." });
        }

        var now = DateTimeOffset.UtcNow;
        var project = new ProjectEntity
        {
            Id = id,
            OwnerId = ownerId,
            Name = request.Name,
            SchemaVersion = request.SchemaVersion,
            Data = request.Data,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync();

        return Results.Created($"/api/projects/{id}", ToDetail(project));
    }

    private static async Task<IResult> GetAsync(string id, ClaimsPrincipal principal, UserManager<ApplicationUser> users, CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var project = await db.Projects.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        return project is null ? Results.NotFound() : Results.Ok(ToDetail(project));
    }

    private static async Task<IResult> UpdateAsync(
        string id,
        SaveProjectRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        if (project is null)
        {
            return Results.NotFound();
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["name"] = ["Project name is required."],
            });
        }

        project.Name = request.Name;
        project.SchemaVersion = request.SchemaVersion;
        project.Data = request.Data;
        project.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
        return Results.Ok(ToDetail(project));
    }

    private static async Task<IResult> DeleteAsync(string id, ClaimsPrincipal principal, UserManager<ApplicationUser> users, CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        if (project is null)
        {
            return Results.NotFound();
        }

        db.Projects.Remove(project);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static ProjectDetail ToDetail(ProjectEntity project) =>
        new(project.Id, project.Name, project.SchemaVersion, project.Data, project.CreatedAt, project.UpdatedAt);
}
