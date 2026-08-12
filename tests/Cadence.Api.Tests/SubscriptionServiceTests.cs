using Cadence.Api.Billing;
using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Cadence.Api.Tests;

/// <summary>
/// Exercises the idempotent subscription applier directly against a SQLite-backed
/// <see cref="CadenceDbContext"/> (relational fidelity without Docker).
/// </summary>
public sealed class SubscriptionServiceTests : IDisposable
{
    private readonly SqliteTestDatabase _database;
    private readonly DbContextOptions<CadenceDbContext> _options;

    public SubscriptionServiceTests()
    {
        _database = new SqliteTestDatabase();
        _options = new DbContextOptionsBuilder<CadenceDbContext>().UseSqlite(_database.ConnectionString).Options;
        using var db = new CadenceDbContext(_options);
        db.Database.EnsureCreated();
    }

    private CadenceDbContext NewContext() => new(_options);

    private async Task SeedUserAsync(string userId, string? customerId)
    {
        await using var db = NewContext();
        db.Users.Add(new ApplicationUser { Id = userId, UserName = $"{userId}@x.com", Email = $"{userId}@x.com", DisplayName = "U" });
        db.Profiles.Add(new UserProfile
        {
            Id = userId,
            UserId = userId,
            DisplayName = "U",
            Tier = SubscriptionTier.Free,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        });
        if (customerId is not null)
        {
            db.Subscriptions.Add(new Subscription
            {
                UserId = userId,
                StripeCustomerId = customerId,
                Status = SubscriptionStatus.None,
                Tier = SubscriptionTier.Free,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }

        await db.SaveChangesAsync();
    }

    private static BillingEvent SubChanged(string id, string customerId, SubscriptionStatus status) =>
        new(id, "customer.subscription.updated", BillingEventKind.SubscriptionChanged, customerId, "sub_1", null, status, DateTimeOffset.UtcNow.AddDays(30));

    [Fact]
    public async Task Apply_SubscriptionActive_UpgradesTierAndMirrorsProfile()
    {
        await SeedUserAsync("user-1", "cus_1");

        await using (var db = NewContext())
        {
            Assert.True(await new SubscriptionService(db).ApplyAsync(SubChanged("evt_1", "cus_1", SubscriptionStatus.Active)));
        }

        await using var verify = NewContext();
        var sub = await verify.Subscriptions.FirstAsync(s => s.UserId == "user-1");
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.Equal(SubscriptionTier.Pro, sub.Tier);
        var profile = await verify.Profiles.FirstAsync(p => p.UserId == "user-1");
        Assert.Equal(SubscriptionTier.Pro, profile.Tier);
    }

    [Fact]
    public async Task Apply_SameEventTwice_IsIdempotent()
    {
        await SeedUserAsync("user-2", "cus_2");
        var evt = SubChanged("evt_dup", "cus_2", SubscriptionStatus.Active);

        bool first, second;
        await using (var db = NewContext()) first = await new SubscriptionService(db).ApplyAsync(evt);
        await using (var db = NewContext()) second = await new SubscriptionService(db).ApplyAsync(evt);

        Assert.True(first);
        Assert.False(second);

        await using var verify = NewContext();
        Assert.Equal(1, await verify.ProcessedBillingEvents.CountAsync());
    }

    [Fact]
    public async Task Apply_PaymentFailed_DowngradesToFree()
    {
        await SeedUserAsync("user-3", "cus_3");
        await using (var db = NewContext()) await new SubscriptionService(db).ApplyAsync(SubChanged("evt_a", "cus_3", SubscriptionStatus.Active));
        await using (var db = NewContext())
        {
            await new SubscriptionService(db).ApplyAsync(new BillingEvent(
                "evt_b", "invoice.payment_failed", BillingEventKind.PaymentFailed, "cus_3", null, null, SubscriptionStatus.None, null));
        }

        await using var verify = NewContext();
        var sub = await verify.Subscriptions.FirstAsync(s => s.UserId == "user-3");
        Assert.Equal(SubscriptionStatus.PastDue, sub.Status);
        Assert.Equal(SubscriptionTier.Free, sub.Tier);
        Assert.Equal(SubscriptionTier.Free, (await verify.Profiles.FirstAsync(p => p.UserId == "user-3")).Tier);
    }

    [Fact]
    public async Task Apply_StaleInvoicePaymentSucceeded_AfterCancel_DoesNotResurrectPro()
    {
        await SeedUserAsync("user-6", "cus_6");

        // Active -> Canceled through the authoritative subscription lifecycle.
        await using (var db = NewContext())
            await new SubscriptionService(db).ApplyAsync(SubChanged("evt_active", "cus_6", SubscriptionStatus.Active));
        await using (var db = NewContext())
            await new SubscriptionService(db).ApplyAsync(new BillingEvent(
                "evt_cancel", "customer.subscription.deleted", BillingEventKind.SubscriptionDeleted,
                "cus_6", "sub_1", null, SubscriptionStatus.Canceled, null));

        // A stale invoice.payment_succeeded (distinct event id, so the idempotency
        // ledger does not suppress it) redelivered AFTER cancellation must NOT flip
        // the now non-paying user back to Active -> Pro.
        await using (var db = NewContext())
            await new SubscriptionService(db).ApplyAsync(new BillingEvent(
                "evt_stale_paid", "invoice.payment_succeeded", BillingEventKind.PaymentSucceeded,
                "cus_6", null, null, SubscriptionStatus.None, null));

        await using var verify = NewContext();
        var sub = await verify.Subscriptions.FirstAsync(s => s.UserId == "user-6");
        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.Equal(SubscriptionTier.Free, sub.Tier);
        Assert.Equal(SubscriptionTier.Free, (await verify.Profiles.FirstAsync(p => p.UserId == "user-6")).Tier);
    }

    [Fact]
    public async Task Apply_CheckoutCompleted_LinksCustomerToUser()
    {
        await SeedUserAsync("user-4", customerId: null);

        var evt = new BillingEvent(
            "evt_co", "checkout.session.completed", BillingEventKind.CheckoutCompleted,
            "cus_4", "sub_4", "user-4", SubscriptionStatus.None, null);
        await using (var db = NewContext()) await new SubscriptionService(db).ApplyAsync(evt);

        await using var verify = NewContext();
        var sub = await verify.Subscriptions.FirstAsync(s => s.UserId == "user-4");
        Assert.Equal("cus_4", sub.StripeCustomerId);
        Assert.Equal("sub_4", sub.StripeSubscriptionId);
    }

    [Fact]
    public async Task Apply_UnknownCustomer_NoOp()
    {
        await SeedUserAsync("user-5", "cus_5");

        await using (var db = NewContext()) await new SubscriptionService(db).ApplyAsync(SubChanged("evt_x", "cus_unknown", SubscriptionStatus.Active));

        await using var verify = NewContext();
        var sub = await verify.Subscriptions.FirstAsync(s => s.UserId == "user-5");
        Assert.Equal(SubscriptionTier.Free, sub.Tier);
    }

    public void Dispose() => _database.Dispose();
}
