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
            project.HasKey(p => p.Id);
            project.Property(p => p.Name).HasMaxLength(256).IsRequired();
            project.Property(p => p.Data).IsRequired();
            project.HasIndex(p => p.OwnerId);
            project
                .HasOne(p => p.Owner)
                .WithMany()
                .HasForeignKey(p => p.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
