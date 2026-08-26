using System.Net.WebSockets;
using Cadence.Data.Entities;

namespace Cadence.Api.Collaboration;

/// <summary>
/// A single collaborator's WebSocket connection to a project room, tagged with
/// the server-resolved <see cref="CollaborationRole"/>. Sends are serialized
/// through a per-connection lock because <see cref="WebSocket"/> forbids
/// concurrent <c>SendAsync</c> calls.
/// </summary>
public sealed class CollabConnection(
    WebSocket socket,
    CollaborationRole role,
    string callerId,
    string ownerId,
    string projectId,
    string? grantId,
    long grantGeneration,
    long userGeneration)
{
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private int _revoked;

    /// <summary>Stable id used to exclude the sender from broadcasts.</summary>
    public Guid Id { get; } = Guid.NewGuid();

    /// <summary>The underlying transport.</summary>
    public WebSocket Socket { get; } = socket;

    /// <summary>Server-authoritative role for this connection.</summary>
    public CollaborationRole Role { get; } = role;

    public string CallerId { get; } = callerId;

    public string OwnerId { get; } = ownerId;

    public string ProjectId { get; } = projectId;

    /// <summary>The validated share grant for non-owner connections.</summary>
    public string? GrantId { get; } = grantId;

    public long GrantGeneration { get; } = grantGeneration;

    public long UserGeneration { get; } = userGeneration;

    public bool IsRevoked => Volatile.Read(ref _revoked) != 0;

    /// <summary>Whether this connection may mutate the shared document.</summary>
    public bool CanWrite => Role != CollaborationRole.Viewer;

    /// <summary>Send one binary frame, serialized against other sends.</summary>
    public async Task SendAsync(ReadOnlyMemory<byte> message, CancellationToken cancellationToken)
    {
        if (IsRevoked) return;
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            if (IsRevoked || Socket.State != WebSocketState.Open) return;
            await Socket.SendAsync(message, WebSocketMessageType.Binary, endOfMessage: true, cancellationToken);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    /// <summary>Atomically revoke and close this connection.</summary>
    public async Task RevokeAsync(string reason, CancellationToken cancellationToken = default)
    {
        if (Interlocked.Exchange(ref _revoked, 1) != 0) return;
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            if (Socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await Socket.CloseOutputAsync(
                    WebSocketCloseStatus.PolicyViolation,
                    reason,
                    cancellationToken);
            }
        }
        catch (WebSocketException)
        {
            // The peer may disappear while revocation is closing it.
        }
        finally
        {
            _sendLock.Release();
        }
    }
}
