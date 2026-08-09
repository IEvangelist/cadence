using System.Net.WebSockets;
using Cadence.Data.Entities;

namespace Cadence.Api.Collaboration;

/// <summary>
/// A single collaborator's WebSocket connection to a project room, tagged with
/// the server-resolved <see cref="CollaborationRole"/>. Sends are serialized
/// through a per-connection lock because <see cref="WebSocket"/> forbids
/// concurrent <c>SendAsync</c> calls.
/// </summary>
public sealed class CollabConnection(WebSocket socket, CollaborationRole role)
{
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    /// <summary>Stable id used to exclude the sender from broadcasts.</summary>
    public Guid Id { get; } = Guid.NewGuid();

    /// <summary>The underlying transport.</summary>
    public WebSocket Socket { get; } = socket;

    /// <summary>Server-authoritative role for this connection.</summary>
    public CollaborationRole Role { get; } = role;

    /// <summary>Whether this connection may mutate the shared document.</summary>
    public bool CanWrite => Role != CollaborationRole.Viewer;

    /// <summary>Send one binary frame, serialized against other sends.</summary>
    public async Task SendAsync(ReadOnlyMemory<byte> message, CancellationToken cancellationToken)
    {
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            await Socket.SendAsync(message, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken);
        }
        finally
        {
            _sendLock.Release();
        }
    }
}
