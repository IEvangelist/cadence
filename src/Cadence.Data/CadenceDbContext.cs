using Cadence.Data.Entities;
using Cadence.Data.Stems;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Cadence.Data;

/// <summary>
/// EF Core context backing ASP.NET Core Identity plus Cadence's own profile and
/// project tables. The model is deliberately provider-agnostic (no Postgres-only
/// column types) so the same model creates cleanly on SQLite in unit tests and on
/// Postgres in production/integration tests.
/// </summary>
public sealed class CadenceDbContext(DbContextOptions<CadenceDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    /// <summary>User profiles (1:1 with users).</summary>
    public DbSet<UserProfile> Profiles => Set<UserProfile>();

    /// <summary>Persisted composer projects.</summary>
    public DbSet<ProjectEntity> Projects => Set<ProjectEntity>();

    /// <summary>Collaboration share links granting roles on projects.</summary>
    public DbSet<ProjectShareLink> ProjectShareLinks => Set<ProjectShareLink>();

    /// <summary>Durable server-side Yjs documents backing live collaboration rooms.</summary>
    public DbSet<CollaborationDocument> CollaborationDocuments => Set<CollaborationDocument>();

    /// <summary>Per-user billing subscriptions (1:1 with users).</summary>
    public DbSet<Subscription> Subscriptions => Set<Subscription>();

    /// <summary>Idempotency ledger of processed Stripe webhook events.</summary>
    public DbSet<ProcessedBillingEvent> ProcessedBillingEvents => Set<ProcessedBillingEvent>();

    /// <summary>Owner-scoped stem-separation jobs.</summary>
    public DbSet<SeparationJob> SeparationJobs => Set<SeparationJob>();

    /// <summary>Separated stems produced by <see cref="SeparationJobs"/>.</summary>
    public DbSet<SeparationStem> SeparationStems => Set<SeparationStem>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<UserProfile>(profile =>
        {
            profile.HasKey(p => p.Id);
            profile.Property(p => p.DisplayName).HasMaxLength(256).IsRequired();
            profile.Property(p => p.Bio).HasMaxLength(1024);
            profile.Property(p => p.AvatarUrl).HasMaxLength(2048);
            profile.Property(p => p.Tier).HasConversion<string>().HasMaxLength(32);
            profile.HasIndex(p => p.UserId).IsUnique();
            profile
                .HasOne(p => p.User)
                .WithOne(u => u.Profile)
                .HasForeignKey<UserProfile>(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ProjectEntity>(project =>
        {
            // Composite, owner-scoped key: a project id is unique per user, not
            // globally. Two users may independently use the same client-generated
            // id without colliding, and no cross-tenant existence oracle exists.
            project.HasKey(p => new { p.OwnerId, p.Id });
            project.Property(p => p.Name).HasMaxLength(256).IsRequired();
            project.Property(p => p.Data).IsRequired();
            project
                .HasOne(p => p.Owner)
                .WithMany()
                .HasForeignKey(p => p.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ProjectShareLink>(share =>
        {
            // The opaque token is the primary key (a bearer secret). Each link
            // references an owner-scoped project via the composite FK and is
            // cascade-deleted with it, so revoking a project revokes its shares.
            share.HasKey(s => s.Token);
            share.Property(s => s.Token).HasMaxLength(128);
            share.Property(s => s.OwnerId).IsRequired();
            share.Property(s => s.ProjectId).IsRequired();
            share.Property(s => s.Role).HasConversion<string>().HasMaxLength(32);
            share.HasIndex(s => new { s.OwnerId, s.ProjectId });
            share
                .HasOne(s => s.Project)
                .WithMany()
                .HasForeignKey(s => new { s.OwnerId, s.ProjectId })
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<CollaborationDocument>(document =>
        {
            // One durable document per owner-scoped project, keyed by the same
            // composite as ProjectEntity and cascade-deleted with the project, so
            // deleting a project reclaims its persisted collaboration state.
            document.HasKey(d => new { d.OwnerId, d.ProjectId });
            document.Property(d => d.OwnerId).IsRequired();
            document.Property(d => d.ProjectId).IsRequired();
            document.Property(d => d.State).IsRequired();
            document
                .HasOne(d => d.Project)
                .WithMany()
                .HasForeignKey(d => new { d.OwnerId, d.ProjectId })
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Subscription>(subscription =>
        {
            // Owner-scoped 1:1: the user id is the primary key, so a user has at
            // most one subscription record and it is addressable only by its owner.
            subscription.HasKey(s => s.UserId);
            subscription.Property(s => s.StripeCustomerId).HasMaxLength(256);
            subscription.Property(s => s.StripeSubscriptionId).HasMaxLength(256);
            subscription.Property(s => s.Status).HasConversion<string>().HasMaxLength(32);
            subscription.Property(s => s.Tier).HasConversion<string>().HasMaxLength(32);
            subscription.HasIndex(s => s.StripeCustomerId);
            subscription
                .HasOne(s => s.User)
                .WithOne()
                .HasForeignKey<Subscription>(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ProcessedBillingEvent>(processed =>
        {
            processed.HasKey(e => e.EventId);
            processed.Property(e => e.EventId).HasMaxLength(256);
            processed.Property(e => e.EventType).HasMaxLength(128);
        });

        builder.Entity<SeparationJob>(job =>
        {
            // Composite, owner-scoped key mirroring ProjectEntity: a job id is
            // unique per user, not globally, so another user's job is a 404 rather
            // than a leak (no cross-tenant existence oracle, no IDOR).
            job.HasKey(j => new { j.OwnerId, j.Id });
            job.Property(j => j.Status).HasConversion<string>().HasMaxLength(32);
            job.Property(j => j.OriginalFileName).HasMaxLength(512).IsRequired();
            job.Property(j => j.ContentType).HasMaxLength(128).IsRequired();
            job.Property(j => j.MixBlobPath).HasMaxLength(1024).IsRequired();
            job.Property(j => j.ErrorMessage).HasMaxLength(1024);
            job.HasIndex(j => j.Status);
            job
                .HasOne(j => j.Owner)
                .WithMany()
                .HasForeignKey(j => j.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            job
                .HasMany(j => j.Stems)
                .WithOne(s => s.Job)
                .HasForeignKey(s => new { s.OwnerId, s.JobId })
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SeparationStem>(stem =>
        {
            // Owner id travels on every stem row so reads stay owner-scoped without
            // a join back to the job.
            stem.HasKey(s => new { s.OwnerId, s.JobId, s.Label });
            stem.Property(s => s.Label).HasConversion<string>().HasMaxLength(32);
            stem.Property(s => s.BlobPath).HasMaxLength(1024).IsRequired();
        });
    }
}
