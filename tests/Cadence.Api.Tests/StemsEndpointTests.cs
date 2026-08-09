using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Cadence.Data;
using Cadence.Data.Entities;
using Cadence.Data.Stems;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Cadence.Api.Tests;

/// <summary>
/// Endpoint tests for <c>/api/stems</c>: the entitlement gate (402 for free),
/// upload validation (415/413/400), the async job lifecycle, owner-scoped reads,
/// and IDOR protection (another user's job/stem is a 404).
/// </summary>
public class StemsEndpointTests
{
    private static Task<HttpResponseMessage> UploadAsync(
        HttpClient client, byte[] bytes, string contentType = "audio/wav", string name = "mix.wav")
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return client.PostAsync($"/api/stems/jobs?name={Uri.EscapeDataString(name)}", content);
    }

    private static async Task PromoteToProAsync(CadenceApiFactory factory, string userId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        var profile = db.Profiles.Single(p => p.UserId == userId);
        profile.Tier = SubscriptionTier.Pro;
        await db.SaveChangesAsync();
    }

    /// <summary>Drain the queue exactly as the background worker would.</summary>
    private static async Task RunWorkerAsync(CadenceApiFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
        var processor = new SeparationJobProcessor(
            db, factory.StemStorage, new BandSplitStemSeparator(), NullLogger<SeparationJobProcessor>.Instance);
        while (await processor.ProcessNextAsync())
        {
        }
    }

    [Fact]
    public async Task Create_FreeUser_Returns402_WithUpgradeType()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        await client.RegisterAsync("stems.free@example.com");

        var response = await UploadAsync(client, StemAudioFixtures.CreateMixWav());

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<Microsoft.AspNetCore.Mvc.ProblemDetails>();
        Assert.Equal(BillingEndpoints.UpgradeRequiredType, problem!.Type);
    }

    [Fact]
    public async Task Create_ProUser_Returns202_AndQueuesJob()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.pro@example.com");
        await PromoteToProAsync(factory, me.Id);

        var response = await UploadAsync(client, StemAudioFixtures.CreateMixWav(), name: "my song.wav");

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var job = await response.Content.ReadFromJsonAsync<StemJobDetail>();
        Assert.Equal(nameof(JobStatus.Queued), job!.Status);
        Assert.Equal("my song.wav", job.OriginalFileName);
        Assert.Empty(job.Stems);
        Assert.NotNull(response.Headers.Location);
    }

    [Fact]
    public async Task Create_DisallowedContentType_Returns415()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.type@example.com");
        await PromoteToProAsync(factory, me.Id);

        var response = await UploadAsync(client, [1, 2, 3], contentType: "text/plain");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task Create_OverSizeCap_Returns413()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["Stems:MaxUploadBytes"] = "16" },
        };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.big@example.com");
        await PromoteToProAsync(factory, me.Id);

        var response = await UploadAsync(client, StemAudioFixtures.CreateMixWav());

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Create_OverDurationCap_Returns413()
    {
        await using var factory = new CadenceApiFactory
        {
            ConfigOverrides = new Dictionary<string, string?> { ["Stems:MaxDurationSeconds"] = "1" },
        };
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.long@example.com");
        await PromoteToProAsync(factory, me.Id);

        // Two seconds of audio against a one-second cap.
        var twoSeconds = StemAudioFixtures.CreateMixWav(sampleRate: 8000, channels: 1, frames: 16000);
        var response = await UploadAsync(client, twoSeconds);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Create_EmptyBody_Returns400()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.empty@example.com");
        await PromoteToProAsync(factory, me.Id);

        var response = await UploadAsync(client, []);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task FullLifecycle_UploadProcessListGetDownload()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.flow@example.com");
        await PromoteToProAsync(factory, me.Id);

        var created = await (await UploadAsync(client, StemAudioFixtures.CreateMixWav()))
            .Content.ReadFromJsonAsync<StemJobDetail>();

        await RunWorkerAsync(factory);

        // The job is now completed with the full stem catalog.
        var job = await client.GetFromJsonAsync<StemJobDetail>($"/api/stems/jobs/{created!.Id}");
        Assert.Equal(nameof(JobStatus.Completed), job!.Status);
        Assert.NotNull(job.CompletedAt);
        Assert.Equal(
            StemCatalog.All.Select(StemCatalog.Slug),
            job.Stems.Select(s => s.Label));

        // It shows up in the owner's listing.
        var list = await client.GetFromJsonAsync<List<StemJobSummary>>("/api/stems/jobs");
        Assert.Contains(list!, j => j.Id == created.Id);

        // Every stem downloads as a valid WAV.
        foreach (var stem in job.Stems)
        {
            var download = await client.GetAsync(stem.Url);
            Assert.Equal(HttpStatusCode.OK, download.StatusCode);
            Assert.Equal("audio/wav", download.Content.Headers.ContentType!.MediaType);
            var bytes = await download.Content.ReadAsByteArrayAsync();
            Assert.True(WavAudio.TryGetDurationSeconds(bytes, out _));
        }
    }

    [Fact]
    public async Task Download_UnknownLabel_Returns404()
    {
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        var me = await client.RegisterAndReadMeAsync("stems.badlabel@example.com");
        await PromoteToProAsync(factory, me.Id);
        var created = await (await UploadAsync(client, StemAudioFixtures.CreateMixWav()))
            .Content.ReadFromJsonAsync<StemJobDetail>();
        await RunWorkerAsync(factory);

        var response = await client.GetAsync($"/api/stems/jobs/{created!.Id}/stems/piano");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Jobs_WhenAnonymous_ReturnUnauthorized()
    {
        await using var factory = new CadenceApiFactory();

        var response = await factory.CreateClient().GetAsync("/api/stems/jobs");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UserB_CannotAccess_UserAJobOrStems()
    {
        await using var factory = new CadenceApiFactory();

        var alice = factory.CreateClient();
        var aliceMe = await alice.RegisterAndReadMeAsync("stems.alice@example.com");
        await PromoteToProAsync(factory, aliceMe.Id);
        var aliceJob = await (await UploadAsync(alice, StemAudioFixtures.CreateMixWav()))
            .Content.ReadFromJsonAsync<StemJobDetail>();
        await RunWorkerAsync(factory);

        var bob = factory.CreateClient();
        var bobMe = await bob.RegisterAndReadMeAsync("stems.bob@example.com");
        await PromoteToProAsync(factory, bobMe.Id);

        // Bob cannot read Alice's job (indistinguishable from missing -> 404).
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/stems/jobs/{aliceJob!.Id}")).StatusCode);

        // Bob cannot download Alice's stems.
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.GetAsync($"/api/stems/jobs/{aliceJob.Id}/stems/vocals")).StatusCode);

        // Bob's listing does not include Alice's job.
        var bobList = await bob.GetFromJsonAsync<List<StemJobSummary>>("/api/stems/jobs");
        Assert.DoesNotContain(bobList!, j => j.Id == aliceJob.Id);
    }
}
