using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.AI;

namespace Cadence.Api.Tests;

/// <summary>
/// Endpoint tests for the optional server-side AI generation route (<c>POST /api/ai/generate</c>,
/// #140). They inject a fake <see cref="IChatClient"/> so nothing touches a real Ollama, and cover
/// the whole contract: the happy path maps to the on-device note shape, the feature is 404 while
/// the flag is off (default), an enabled-but-absent local model is 503, malformed model output is
/// clamped or rejected (never 500), and the #71 daily cap returns 429 with <c>Retry-After</c> and
/// is isolated per user.
/// </summary>
public class AiGenerateEndpointTests
{
    private const string ValidNotesJson =
        """{"notes":[{"pitch":64,"start":0,"duration":1,"velocity":0.8},{"pitch":67,"start":1,"duration":1,"velocity":0.7}]}""";

    private static readonly AiGenerateParams DefaultParams = new(Temperature: 1.0, LengthBeats: 8);

    private static CadenceApiFactory EnabledFactory(
        IChatClient? chatClient,
        IReadOnlyDictionary<string, string?>? extraConfig = null)
    {
        var config = new Dictionary<string, string?> { ["Ai:ServerSide:Enabled"] = "true" };
        if (extraConfig is not null)
        {
            foreach (var pair in extraConfig)
            {
                config[pair.Key] = pair.Value;
            }
        }

        return new CadenceApiFactory { ConfigOverrides = config, ChatClient = chatClient };
    }

    private static AiGenerateRequest ContinueRequest() =>
        new("continue", [new AiNote(60, 0, 1, 0.8)], RegionStart: 0, Tempo: 120, DefaultParams);

    private static Task<HttpResponseMessage> GenerateAsync(HttpClient client, AiGenerateRequest? request = null) =>
        client.PostAsJsonAsync("/api/ai/generate", request ?? ContinueRequest());

    [Fact]
    public async Task Generate_ValidModelOutput_Returns200_WithOnDeviceNoteContract()
    {
        await using var factory = EnabledFactory(new FakeChatClient(ValidNotesJson));
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.happy@example.com");

        var response = await GenerateAsync(client);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<AiGenerateResponse>();
        Assert.Equal("continue", body!.Action);
        Assert.Equal("Continued 8 beats", body.Label);
        Assert.Equal(2, body.Notes.Count);

        var note = body.Notes[0];
        Assert.Equal(64, note.Pitch);
        Assert.InRange(note.Pitch, 0, 127);
        Assert.True(note.Start >= 0);
        Assert.True(note.Duration > 0);
        Assert.InRange(note.Velocity, 0, 1);
    }

    [Fact]
    public async Task Generate_FeatureDisabledByDefault_Returns404()
    {
        // No ConfigOverride: the flag defaults off, so the route is never mapped and the
        // default (on-device only) experience is unchanged.
        await using var factory = new CadenceApiFactory();
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.off@example.com");

        var response = await GenerateAsync(client);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Generate_EnabledButLocalModelAbsent_Returns503()
    {
        // Enabled, but no IChatClient registered — exactly the CI / normal-F5 case where the
        // explicit-start Ollama resource was never started.
        await using var factory = EnabledFactory(chatClient: null);
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.absent@example.com");

        var response = await GenerateAsync(client);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Generate_OutOfRangeModelOutput_IsClampedTo200()
    {
        const string outOfRange = """{"notes":[{"pitch":999,"start":-4,"duration":0,"velocity":9}]}""";
        await using var factory = EnabledFactory(new FakeChatClient(outOfRange));
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.clamp@example.com");

        var response = await GenerateAsync(client);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<AiGenerateResponse>();
        var note = Assert.Single(body!.Notes);
        Assert.Equal(127, note.Pitch);
        Assert.Equal(0, note.Start);
        Assert.True(note.Duration > 0);
        Assert.Equal(1, note.Velocity);
    }

    [Fact]
    public async Task Generate_UnparseableModelOutput_Returns422_NotError()
    {
        await using var factory = EnabledFactory(new FakeChatClient("I'm sorry, I can't compose that."));
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.invalid@example.com");

        var response = await GenerateAsync(client);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task Generate_UnknownAction_Returns400()
    {
        await using var factory = EnabledFactory(new FakeChatClient(ValidNotesJson));
        var client = factory.CreateClient();
        await client.RegisterAsync("ai.badaction@example.com");

        var request = new AiGenerateRequest("frobnicate", [], RegionStart: 0, Tempo: 120, DefaultParams);
        var response = await client.PostAsJsonAsync("/api/ai/generate", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Generate_ExceedingDailyCap_Returns429_WithRetryAfter_AndIsPerUser()
    {
        // Drop the Free daily budget to 2 so the cap is cheap to hit.
        await using var factory = EnabledFactory(
            new FakeChatClient(ValidNotesJson),
            new Dictionary<string, string?> { ["Billing:Entitlements:Free:AiGenerationsPerDay"] = "2" });

        var alice = factory.CreateClient();
        await alice.RegisterAsync("ai.cap.alice@example.com");

        Assert.Equal(HttpStatusCode.OK, (await GenerateAsync(alice)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await GenerateAsync(alice)).StatusCode);

        var capped = await GenerateAsync(alice);
        Assert.Equal(HttpStatusCode.TooManyRequests, capped.StatusCode);
        Assert.NotNull(capped.Headers.RetryAfter);
        Assert.True(capped.Headers.RetryAfter!.Delta is { } delta && delta > TimeSpan.Zero);

        // A different user on the same host has an independent daily budget.
        var bob = factory.CreateClient();
        await bob.RegisterAsync("ai.cap.bob@example.com");
        Assert.Equal(HttpStatusCode.OK, (await GenerateAsync(bob)).StatusCode);
    }

    [Fact]
    public async Task Generate_FailedGeneration_DoesNotConsumeBudget()
    {
        // A 422 must not burn a generation: with a budget of 1, an unparseable attempt still
        // leaves a subsequent valid attempt able to succeed.
        var responder = new SwitchableChatClient("not json");
        await using var factory = EnabledFactory(
            responder,
            new Dictionary<string, string?> { ["Billing:Entitlements:Free:AiGenerationsPerDay"] = "1" });

        var client = factory.CreateClient();
        await client.RegisterAsync("ai.budget@example.com");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await GenerateAsync(client)).StatusCode);

        responder.Response = ValidNotesJson;
        Assert.Equal(HttpStatusCode.OK, (await GenerateAsync(client)).StatusCode);
    }

    /// <summary>A fake whose canned response can be swapped between calls.</summary>
    private sealed class SwitchableChatClient(string response) : IChatClient
    {
        public string Response { get; set; } = response;

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, Response)));

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public object? GetService(Type serviceType, object? serviceKey = null) => null;

        public void Dispose()
        {
        }
    }
}
