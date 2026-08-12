using Microsoft.Extensions.AI;

namespace Cadence.Api.Tests;

/// <summary>
/// A canned <see cref="IChatClient"/> for the server-side AI endpoint tests: it returns a
/// fixed assistant message (or one computed per request) without any network, so the tests
/// exercise the endpoint's mapping/validation/cap logic against deterministic model output.
/// </summary>
internal sealed class FakeChatClient(string responseText) : IChatClient
{
    private readonly string _responseText = responseText;

    /// <summary>Optional per-request responder; when set it overrides the fixed text.</summary>
    public Func<IReadOnlyList<ChatMessage>, ChatOptions?, string>? Responder { get; init; }

    /// <summary>Number of completed <see cref="GetResponseAsync"/> calls (cap tests assert on this).</summary>
    public int CallCount { get; private set; }

    public Task<ChatResponse> GetResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        CallCount++;
        var list = messages as IReadOnlyList<ChatMessage> ?? messages.ToList();
        var text = Responder is null ? _responseText : Responder(list, options);
        return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, text)));
    }

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
        IEnumerable<ChatMessage> messages,
        ChatOptions? options = null,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("The AI generation endpoint does not use streaming responses.");

    public object? GetService(Type serviceType, object? serviceKey = null) => null;

    public void Dispose()
    {
    }
}
