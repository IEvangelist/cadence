using Cadence.Data.Entities;
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

    /// <summary>Per-user billing subscriptions (1:1 with users).</summary>
    public DbSet<Subscription> Subscriptions => Set<Subscription>();

    /// <summary>Idempotency ledger of processed Stripe webhook events.</summary>
    public DbSet<ProcessedBillingEvent> ProcessedBillingEvents => Set<ProcessedBillingEvent>();

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
    }
}
