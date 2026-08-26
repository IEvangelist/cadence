using System.Net;
using System.Net.Http.Json;
using Cadence.Api;

namespace Cadence.Api.Tests;

public class ExpectedOwnerGuardTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    [Fact]
    public async Task Mutation_with_stale_expected_owner_is_rejected_before_endpoint()
    {
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("owner.guard@example.com");
        client.DefaultRequestHeaders.Add(ExpectedOwnerGuard.HeaderName, "previous-owner");

        var rejected = await client.PostAsJsonAsync(
            "/api/projects",
            new SaveProjectRequest("owner-guard", "Rejected", 1, "{}"));

        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        client.DefaultRequestHeaders.Remove(ExpectedOwnerGuard.HeaderName);
        var projects = await client.GetFromJsonAsync<List<ProjectSummary>>("/api/projects");
        Assert.Empty(projects!);

        client.DefaultRequestHeaders.Add(ExpectedOwnerGuard.HeaderName, me.Id);
        var accepted = await client.PostAsJsonAsync(
            "/api/projects",
            new SaveProjectRequest("owner-guard", "Accepted", 1, "{}"));
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }
}
