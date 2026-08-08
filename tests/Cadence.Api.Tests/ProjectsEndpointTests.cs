using System.Net;
using System.Net.Http.Json;

namespace Cadence.Api.Tests;

public class ProjectsEndpointTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private static SaveProjectRequest NewProject(string name = "My Song", string? id = null) =>
        new(id, name, SchemaVersion: 1, Data: "{\"tracks\":[]}");

    [Fact]
    public async Task Create_Then_Get_ReturnsProject()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.create@example.com");

        var create = await client.PostAsJsonAsync("/api/projects", NewProject("First Track"));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<ProjectDetail>();
        Assert.Equal("First Track", created!.Name);
        Assert.Equal("{\"tracks\":[]}", created.Data);

        var get = await client.GetAsync($"/api/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var fetched = await get.Content.ReadFromJsonAsync<ProjectDetail>();
        Assert.Equal(created.Id, fetched!.Id);
    }

    [Fact]
    public async Task Create_WithClientProvidedId_IsHonored()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.id@example.com");

        var create = await client.PostAsJsonAsync("/api/projects", NewProject(id: "client-id-123"));
        var created = await create.Content.ReadFromJsonAsync<ProjectDetail>();

        Assert.Equal("client-id-123", created!.Id);
    }

    [Fact]
    public async Task Create_DuplicateId_ReturnsConflict()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.dup@example.com");
        await client.PostAsJsonAsync("/api/projects", NewProject(id: "dupe"));

        var second = await client.PostAsJsonAsync("/api/projects", NewProject(id: "dupe"));

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    // Issue E: project ids are owner-scoped (composite key), so two different users
    // may each use the same client-provided id without a cross-tenant conflict, and
    // there is no global existence oracle on create.
    [Fact]
    public async Task Create_SameClientId_ForDifferentOwners_DoesNotConflict()
    {
        const string sharedId = "shared-client-id";

        var alice = _factory.CreateClient();
        await alice.RegisterAsync("e.alice@example.com");
        var aliceCreate = await alice.PostAsJsonAsync("/api/projects", NewProject("Alice", sharedId));
        Assert.Equal(HttpStatusCode.Created, aliceCreate.StatusCode);

        var bob = _factory.CreateClient();
        await bob.RegisterAsync("e.bob@example.com");
        var bobCreate = await bob.PostAsJsonAsync("/api/projects", NewProject("Bob", sharedId));
        Assert.Equal(HttpStatusCode.Created, bobCreate.StatusCode);

        // Each owner reads back their own copy under the shared id.
        var aliceGet = await (await alice.GetAsync($"/api/projects/{sharedId}"))
            .Content.ReadFromJsonAsync<ProjectDetail>();
        var bobGet = await (await bob.GetAsync($"/api/projects/{sharedId}"))
            .Content.ReadFromJsonAsync<ProjectDetail>();

        Assert.Equal("Alice", aliceGet!.Name);
        Assert.Equal("Bob", bobGet!.Name);
    }

    [Fact]
    public async Task Create_WithBlankName_ReturnsValidationProblem()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.blank@example.com");

        var response = await client.PostAsJsonAsync("/api/projects", NewProject(name: "   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task List_ReturnsOnlyOwnProjects()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.list@example.com");
        await client.PostAsJsonAsync("/api/projects", NewProject("A"));
        await client.PostAsJsonAsync("/api/projects", NewProject("B"));

        var list = await client.GetFromJsonAsync<List<ProjectSummary>>("/api/projects");

        Assert.Equal(2, list!.Count);
    }

    [Fact]
    public async Task Update_ModifiesProject()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.update@example.com");
        var created = await (await client.PostAsJsonAsync("/api/projects", NewProject("Before")))
            .Content.ReadFromJsonAsync<ProjectDetail>();

        var update = await client.PutAsJsonAsync($"/api/projects/{created!.Id}",
            new SaveProjectRequest(created.Id, "After", 2, "{\"tracks\":[1]}"));

        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await update.Content.ReadFromJsonAsync<ProjectDetail>();
        Assert.Equal("After", updated!.Name);
        Assert.Equal(2, updated.SchemaVersion);
    }

    [Fact]
    public async Task Delete_RemovesProject()
    {
        var client = _factory.CreateClient();
        await client.RegisterAsync("proj.delete@example.com");
        var created = await (await client.PostAsJsonAsync("/api/projects", NewProject()))
            .Content.ReadFromJsonAsync<ProjectDetail>();

        var delete = await client.DeleteAsync($"/api/projects/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        var get = await client.GetAsync($"/api/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
    }

    [Fact]
    public async Task Projects_WhenAnonymous_ReturnUnauthorized()
    {
        var response = await _factory.CreateClient().GetAsync("/api/projects");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // --- Authorization: a user cannot read or modify another user's projects. ---

    [Fact]
    public async Task UserB_CannotAccess_UserAProject()
    {
        var alice = _factory.CreateClient();
        await alice.RegisterAsync("alice@example.com");
        var aliceProject = await (await alice.PostAsJsonAsync("/api/projects", NewProject("Alice Secret")))
            .Content.ReadFromJsonAsync<ProjectDetail>();

        var bob = _factory.CreateClient();
        await bob.RegisterAsync("bob@example.com");

        // Bob cannot read Alice's project (indistinguishable from missing -> 404).
        var read = await bob.GetAsync($"/api/projects/{aliceProject!.Id}");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);

        // Bob cannot update Alice's project.
        var update = await bob.PutAsJsonAsync($"/api/projects/{aliceProject.Id}",
            new SaveProjectRequest(aliceProject.Id, "Hijacked", 1, "{}"));
        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);

        // Bob cannot delete Alice's project.
        var delete = await bob.DeleteAsync($"/api/projects/{aliceProject.Id}");
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);

        // Bob's list does not include Alice's project.
        var bobList = await bob.GetFromJsonAsync<List<ProjectSummary>>("/api/projects");
        Assert.Empty(bobList!);

        // Alice's project is untouched.
        var aliceRead = await alice.GetAsync($"/api/projects/{aliceProject.Id}");
        var aliceProjectAfter = await aliceRead.Content.ReadFromJsonAsync<ProjectDetail>();
        Assert.Equal("Alice Secret", aliceProjectAfter!.Name);
    }
}
