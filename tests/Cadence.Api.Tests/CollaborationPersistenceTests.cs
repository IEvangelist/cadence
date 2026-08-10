using System.Net.Http.Json;
using System.Net.WebSockets;
using Cadence.Api.Collaboration;
using Cadence.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Cadence.Api.Tests;

/// <summary>
/// End-to-end tests for server-side Yjs document persistence (issue #91): a
/// collaboration room must survive all of its peers disconnecting. The relay
/// persists the room's update log when its last peer leaves and answers a
/// reconnecting client's sync-step-1 request from that durable log, so a client
/// that rejoins an "empty" room converges from the server rather than losing edits.
///
/// These use raw y-protocol frames (not a real y-websocket) so the assertions are
/// deterministic. Because the existing relay tests never send a sync-step-1, the
/// server's new responder is invisible to them and they stay green.
/// </summary>
public class CollaborationPersistenceTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private static readonly TimeSpan ReceiveTimeout = TimeSpan.FromSeconds(5);

    // sync(0) + syncStep1(0): a read-only state request the relay answers from its log.
    private static byte[] SyncStep1() => [0x00, 0x00];

    // sync(0) + update(2) + len(1) + payload: a document write the relay logs.
    private static byte[] SyncUpdate(byte marker) => [0x00, 0x02, 0x01, marker];

    private static SaveProjectRequest NewProject(string id) =>
        new(id, "Persisted Song", SchemaVersion: 1, Data: "{\"tracks\":[]}");

    [Fact]
    public async Task PersistedDocument_SurvivesDisconnect_AndRehydratesReconnectingClient()
    {
        var (owner, cookie) = await RegisterAsync("persist.rehydrate@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("persist-rehydrate"))).AssertOkAsync();

        // First session: a lone editor writes one update, then disconnects. The
        // room empties, so the relay persists its log to the database.
        using (var first = await ConnectAsync(cookie, "persist-rehydrate", token: null))
        {
            await SendAsync(first, SyncUpdate(0xAB));
            await first.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        }

        await WaitForPersistedAsync("persist-rehydrate");

        // Second session: a fresh client asks for state (sync-step-1). The relay
        // must reply with the persisted update as a sync-step-2, so the client
        // adopts the server's document instead of reseeding from a stale snapshot.
        using var second = await ConnectAsync(cookie, "persist-rehydrate", token: null);
        await SendAsync(second, SyncStep1());

        Assert.Equal(YProtocol.BuildSyncStep2([0xAB]), await ReceiveAsync(second));
    }

    [Fact]
    public async Task FreshRoom_AnswersSyncStep1_WithEmptyDocument()
    {
        var (owner, cookie) = await RegisterAsync("persist.fresh@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("persist-fresh"))).AssertOkAsync();

        // A brand-new room has no persisted state. The relay still replies to
        // sync-step-1 with an empty sync-step-2, which flips the first client to
        // "synced" so it seeds the fresh document (rather than hanging unsynced).
        using var socket = await ConnectAsync(cookie, "persist-fresh", token: null);
        await SendAsync(socket, SyncStep1());

        Assert.Equal(YProtocol.BuildSyncStep2(YProtocol.EmptyDocumentUpdate), await ReceiveAsync(socket));
    }

    [Fact]
    public async Task ViewerReconnecting_ReceivesPersistedState()
    {
        var (owner, ownerCookie) = await RegisterAsync("persist.viewer.owner@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("persist-viewer"))).AssertOkAsync();
        var viewerToken = await CreateShareAsync(owner, "persist-viewer", "viewer");

        using (var editor = await ConnectAsync(ownerCookie, "persist-viewer", token: null))
        {
            await SendAsync(editor, SyncUpdate(0xCD));
            await editor.CloseAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        }

        await WaitForPersistedAsync("persist-viewer");

        // A viewer may READ: sync-step-1 is not a write, so the role gate lets it
        // through and the viewer is rehydrated from the persisted document. (The
        // viewer's write rejection is covered by CollaborationRelayTests.)
        var (_, viewerCookie) = await RegisterAsync("persist.viewer.reader@example.com");
        using var viewer = await ConnectAsync(viewerCookie, "persist-viewer", viewerToken);
        await SendAsync(viewer, SyncStep1());

        Assert.Equal(YProtocol.BuildSyncStep2([0xCD]), await ReceiveAsync(viewer));
    }

    private async Task<(HttpClient Client, string Cookie)> RegisterAsync(string email)
    {
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false,
        });
        var response = await client.RegisterAsync(email);
        response.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(c => c.Split(';')[0]));
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        return (client, cookie);
    }

    private async Task<string> CreateShareAsync(HttpClient owner, string projectId, string role)
    {
        var response = await owner.PostAsJsonAsync($"/api/projects/{projectId}/shares", new CreateShareLinkRequest(role));
        response.EnsureSuccessStatusCode();
        var link = await response.Content.ReadFromJsonAsync<ShareLinkResponse>();
        return link!.Token;
    }

    private async Task<WebSocket> ConnectAsync(string cookie, string projectId, string? token)
    {
        var wsClient = _factory.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = request => request.Headers["Cookie"] = cookie;
        var uri = new UriBuilder(_factory.Server.BaseAddress)
        {
            Path = $"/api/collab/{projectId}",
            Query = token is null ? string.Empty : $"token={token}",
        }.Uri;
        return await wsClient.ConnectAsync(uri, CancellationToken.None);
    }

    private static Task SendAsync(WebSocket socket, byte[] frame) =>
        socket.SendAsync(frame, WebSocketMessageType.Binary, endOfMessage: true, CancellationToken.None);

    private static async Task<byte[]> ReceiveAsync(WebSocket socket)
    {
        using var cts = new CancellationTokenSource(ReceiveTimeout);
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cts.Token);
            stream.Write(buffer, 0, result.Count);
        }
        while (!result.EndOfMessage);
        return stream.ToArray();
    }

    // Poll until the relay has persisted the room's document, so the reconnect
    // assertions run against a durable row (not a race with the save-on-leave).
    private async Task WaitForPersistedAsync(string projectId)
    {
        using var cts = new CancellationTokenSource(ReceiveTimeout);
        while (true)
        {
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<CadenceDbContext>();
                if (await db.CollaborationDocuments.AsNoTracking().AnyAsync(d => d.ProjectId == projectId, cts.Token))
                {
                    return;
                }
            }

            await Task.Delay(25, cts.Token);
        }
    }
}
