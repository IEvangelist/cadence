using System.Net;
using System.Net.Http.Json;
using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>
/// Verifies the server-authoritative entitlement gate on project creation: a free
/// user hitting their project cap gets <c>402 Payment Required</c>, while a Pro
/// user is unlimited. The cap is lowered via config so the test stays fast.
/// </summary>
public class ProjectEntitlementEnforcementTests
{
    private static SaveProjectRequest NewProject(string name) => new(null, name, SchemaVersion: 1, Data: "{}");

    [Fact]
    public async Task Create_FreeUser_OverProjectCap_Returns402()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["Billing:Entitlements:Free:MaxProjects"] = "1" },
        };
        var client = factory.CreateClient();
        await client.RegisterAsync("cap.free@example.com");

        var first = await client.PostAsJsonAsync("/api/projects", NewProject("One"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await client.PostAsJsonAsync("/api/projects", NewProject("Two"));
        Assert.Equal(HttpStatusCode.PaymentRequired, second.StatusCode);

        // Typed problem body pointing at the upgrade.
        var problem = await second.Content.ReadFromJsonAsync<Microsoft.AspNetCore.Mvc.ProblemDetails>();
        Assert.Equal(BillingEndpoints.UpgradeRequiredType, problem!.Type);
    }

    [Fact]
    public async Task Create_ProUser_IsUnlimited()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["Billing:Entitlements:Free:MaxProjects"] = "1" },
        };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("cap.pro@example.com");

        // Promote to Pro directly (as a webhook would).
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
            var profile = db.Profiles.Single(p => p.UserId == me.Id);
            profile.Tier = SubscriptionTier.Pro;
            await db.SaveChangesAsync();
        }

        for (var i = 0; i < 3; i++)
        {
            var response = await client.PostAsJsonAsync("/api/projects", NewProject($"Song {i}"));
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }
    }
}
