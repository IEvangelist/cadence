using System.Net;
using System.Net.Http.Json;

namespace Cadence.Api.Tests;

/// <summary>
/// Authorization tests for the owner-scoped share-link API. A share link is an
/// access-control primitive, so these assert the endpoints fail closed: only a
/// project's owner may manage its links, and another user's project is a 404.
/// </summary>
public class ShareLinkEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private static SaveProjectRequest NewProject(string id) =>
        new(id, "Shared Song", SchemaVersion: 1, Data: "{\"tracks\":[]}");

    private async Task<HttpClient> OwnerWithProjectAsync(string email, string projectId)
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync(email);
        var create = await client.PostAsJsonAsync("/api/projects", NewProject(projectId));
        create.EnsureSuccessStatusCode();
        return client;
    }

    [Fact]
    public async Task Owner_CanCreateListAndRevokeShareLinks()
    {
        var client = await OwnerWithProjectAsync("share.owner@example.com", "share-p1");

        var create = await client.PostAsJsonAsync(
            "/api/projects/share-p1/shares",
            new CreateShareLinkRequest("viewer"));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var link = await create.Content.ReadFromJsonAsync<ShareLinkResponse>();
        Assert.Equal("viewer", link!.Role);
        Assert.False(string.IsNullOrWhiteSpace(link.OwnerId));
        Assert.False(string.IsNullOrWhiteSpace(link.Token));

        var list = await client.GetFromJsonAsync<List<ShareLinkResponse>>("/api/projects/share-p1/shares");
        Assert.Single(list!);

        var revoke = await client.DeleteAsync($"/api/projects/share-p1/shares/{link.Token}");
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        var afterList = await client.GetFromJsonAsync<List<ShareLinkResponse>>("/api/projects/share-p1/shares");
        Assert.Empty(afterList!);
    }

    [Fact]
    public async Task Create_WithInvalidRole_IsRejected()
    {
        var client = await OwnerWithProjectAsync("share.badrole@example.com", "share-p2");

        // 'owner' is not grantable via a share link; unknown roles fail closed.
        var ownerRole = await client.PostAsJsonAsync(
            "/api/projects/share-p2/shares",
            new CreateShareLinkRequest("owner"));
        Assert.Equal(HttpStatusCode.BadRequest, ownerRole.StatusCode);

        var nonsense = await client.PostAsJsonAsync(
            "/api/projects/share-p2/shares",
            new CreateShareLinkRequest("superuser"));
        Assert.Equal(HttpStatusCode.BadRequest, nonsense.StatusCode);
    }

    [Fact]
    public async Task NonOwner_CannotManageShareLinks_And404sLikeMissing()
    {
        await OwnerWithProjectAsync("share.owner2@example.com", "share-p3");

        // A different authenticated user must not see or mint links for a project
        // they don't own — and gets a 404 (indistinguishable from "no such project").
        var other = _factory.CreateClient();
        await other.RegisterAsync("share.intruder@example.com");

        var list = await other.GetAsync("/api/projects/share-p3/shares");
        Assert.Equal(HttpStatusCode.NotFound, list.StatusCode);

        var create = await other.PostAsJsonAsync(
            "/api/projects/share-p3/shares",
            new CreateShareLinkRequest("editor"));
        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
    }

    [Fact]
    public async Task ShareEndpoints_RequireAuthentication()
    {
        var anon = _factory.CreateClient();

        var list = await anon.GetAsync("/api/projects/whatever/shares");
        Assert.Equal(HttpStatusCode.Unauthorized, list.StatusCode);

        var create = await anon.PostAsJsonAsync(
            "/api/projects/whatever/shares",
            new CreateShareLinkRequest("viewer"));
        Assert.Equal(HttpStatusCode.Unauthorized, create.StatusCode);
    }
}
