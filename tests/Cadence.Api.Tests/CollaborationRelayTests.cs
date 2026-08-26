using System.Net;
using System.Net.Http.Json;
using Cadence.Api.Collaboration;
using Microsoft.Extensions.DependencyInjection;
using System.Net.WebSockets;

namespace Cadence.Api.Tests;

/// <summary>
/// Server-side authorization tests for the collaboration WebSocket relay. These
/// are the security-critical assertions for issue #9: the relay must derive each
/// connection's role from server state and reject a viewer's document writes
/// <em>server-side</em>, so a read-only collaborator cannot mutate the shared
/// document even with a tampered client.
/// </summary>
public class CollaborationRelayTests(CadenceApiFactory factory) : IClassFixture<CadenceApiFactory>
{
    private readonly CadenceApiFactory _factory = factory;

    private static readonly TimeSpan ReceiveTimeout = TimeSpan.FromSeconds(5);

    // y-protocol frames. Awareness (type 1) is always allowed; a sync update
    // (type 0, sub-type 2) is a document write that viewers must not be able to send.
    private static byte[] Awareness(byte marker) => [0x01, marker];

    private static byte[] SyncUpdate(byte marker) => [0x00, 0x02, 0x01, marker];

    private static SaveProjectRequest NewProject(string id) =>
        new(id, "Relay Song", SchemaVersion: 1, Data: "{\"tracks\":[]}");

    private async Task<(HttpClient Client, string Cookie)> RegisterAsync(string email)
    {
        // HandleCookies=false so the auth cookie is visible in the response and can
        // be forwarded onto the WebSocket upgrade request (TestHost has no jar).
        var client = _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            HandleCookies = false,
        });
        var response = await client.RegisterAsync(email);
        response.EnsureSuccessStatusCode();
        var cookie = string.Join("; ", response.Headers.GetValues("Set-Cookie").Select(c => c.Split(';')[0]));
        if (!client.DefaultRequestHeaders.Contains("Cookie"))
        {
            client.DefaultRequestHeaders.Add("Cookie", cookie);
        }
        return (client, cookie);
    }

    private async Task<string> CreateShareAsync(HttpClient owner, string projectId, string role)
    {
        var response = await owner.PostAsJsonAsync(
            $"/api/projects/{projectId}/shares",
            new CreateShareLinkRequest(role));
        response.EnsureSuccessStatusCode();
        var link = await response.Content.ReadFromJsonAsync<ShareLinkResponse>();
        return link!.Token;
    }

    private async Task<WebSocket> ConnectAsync(string cookie, string projectId, string? token)
    {
        var wsClient = _factory.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = request =>
        {
            request.Headers["Cookie"] = cookie;
            request.Headers["Origin"] = CadenceCors.DefaultOrigin;
        };
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

    private static async Task<WebSocketReceiveResult> ReceiveCloseAsync(WebSocket socket)
    {
        using var cts = new CancellationTokenSource(ReceiveTimeout);
        var buffer = new byte[1024];
        return await socket.ReceiveAsync(buffer, cts.Token);
    }

    // Try to read one full frame within a short window; returns null on timeout
    // so the caller can re-probe. Used only by the join handshake.
    private static async Task<byte[]?> TryReceiveAsync(WebSocket socket, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        var buffer = new byte[64 * 1024];
        using var stream = new MemoryStream();
        try
        {
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cts.Token);
                stream.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        return stream.ToArray();
    }

    // Confirm both peers are registered in the room and the broadcast path works,
    // so subsequent per-frame assertions are deterministic (not racing the join).
    //
    // The server-side room join runs asynchronously and can lag the moment
    // ConnectAsync returns to the client, so an awareness probe sent too early is
    // broadcast to a room the other peer has not joined yet and is silently
    // dropped. Re-probe with a fresh marker until each peer observes the other's,
    // which both proves membership and leaves no residual frames queued.
    private static async Task HandshakeAsync(WebSocket first, WebSocket second)
    {
        await ProbeUntilDeliveredAsync(first, second, markerBase: 0xF0);
        await ProbeUntilDeliveredAsync(second, first, markerBase: 0xE0);
    }

    private static async Task ProbeUntilDeliveredAsync(WebSocket sender, WebSocket receiver, byte markerBase)
    {
        var probeTimeout = TimeSpan.FromMilliseconds(500);
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var marker = (byte)(markerBase + (attempt & 0x0F));
            await SendAsync(sender, Awareness(marker));
            var frame = await TryReceiveAsync(receiver, probeTimeout);
            if (frame is not null && frame.Length == 2 && frame[0] == 0x01 && frame[1] == marker)
            {
                return;
            }
        }

        Assert.Fail("Collaboration handshake did not converge: peer never joined the room.");
    }

    [Fact]
    public async Task Editor_CanWrite_UpdateReachesOtherPeers()
    {
        var (owner, _) = await RegisterAsync("relay.owner.a@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-a"))).AssertOkAsync();
        var editorToken = await CreateShareAsync(owner, "relay-a", "editor");
        var viewerToken = await CreateShareAsync(owner, "relay-a", "viewer");

        var (editorUser, editorCookie) = await RegisterAsync("relay.editor.a@example.com");
        var (viewerUser, viewerCookie) = await RegisterAsync("relay.viewer.a@example.com");
        _ = editorUser;
        _ = viewerUser;

        using var editor = await ConnectAsync(editorCookie, "relay-a", editorToken);
        using var viewer = await ConnectAsync(viewerCookie, "relay-a", viewerToken);
        await HandshakeAsync(editor, viewer);

        // Editors may write: the update must be broadcast to the viewer verbatim.
        var update = SyncUpdate(0xAB);
        await SendAsync(editor, update);
        Assert.Equal(update, await ReceiveAsync(viewer));
    }

    [Fact]
    public async Task Viewer_CannotWrite_UpdateIsDroppedServerSide()
    {
        var (owner, _) = await RegisterAsync("relay.owner.b@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-b"))).AssertOkAsync();
        var editorToken = await CreateShareAsync(owner, "relay-b", "editor");
        var viewerToken = await CreateShareAsync(owner, "relay-b", "viewer");

        var (_, editorCookie) = await RegisterAsync("relay.editor.b@example.com");
        var (_, viewerCookie) = await RegisterAsync("relay.viewer.b@example.com");

        using var editor = await ConnectAsync(editorCookie, "relay-b", editorToken);
        using var viewer = await ConnectAsync(viewerCookie, "relay-b", viewerToken);
        await HandshakeAsync(editor, viewer);

        // The viewer attempts a document write, then an allowed awareness frame.
        // The relay must DROP the write and forward only the awareness frame, so
        // the first frame the editor sees is the marker — proving the write never
        // left the server.
        await SendAsync(viewer, SyncUpdate(0x66));
        await SendAsync(viewer, Awareness(0x99));
        Assert.Equal(Awareness(0x99), await ReceiveAsync(editor));
    }

    [Fact]
    public async Task Revoked_editor_grant_closes_live_socket_and_blocks_further_writes()
    {
        var (owner, ownerCookie) = await RegisterAsync("relay.revoke.owner@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-revoke"))).AssertOkAsync();
        var editorToken = await CreateShareAsync(owner, "relay-revoke", "editor");
        var (_, editorCookie) = await RegisterAsync("relay.revoke.editor@example.com");

        using var ownerSocket = await ConnectAsync(ownerCookie, "relay-revoke", token: null);
        using var editorSocket = await ConnectAsync(editorCookie, "relay-revoke", editorToken);
        await HandshakeAsync(ownerSocket, editorSocket);

        var revoke = await owner.DeleteAsync(
            $"/api/projects/relay-revoke/shares/{editorToken}");
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        var close = await ReceiveCloseAsync(editorSocket);
        Assert.Equal(WebSocketMessageType.Close, close.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, close.CloseStatus);
        Assert.NotEqual(WebSocketState.Open, editorSocket.State);
        await SendAsync(editorSocket, SyncUpdate(0xCC));
        Assert.Null(await TryReceiveAsync(ownerSocket, TimeSpan.FromMilliseconds(500)));
        Assert.Equal(WebSocketState.Open, ownerSocket.State);
    }

    [Fact]
    public async Task Logout_closes_every_live_socket_for_that_account()
    {
        var (owner, ownerCookie) = await RegisterAsync("relay.logout.owner@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-logout"))).AssertOkAsync();
        using var socket = await ConnectAsync(ownerCookie, "relay-logout", token: null);
        var me = await owner.GetFromJsonAsync<MeResponse>("/api/auth/me");
        var hub = _factory.Services.GetRequiredService<CollabHub>();
        await WaitUntilAsync(() => hub.Count($"{me!.Id}:relay-logout") == 1);

        var logout = await owner.PostAsync("/api/auth/logout", content: null);
        logout.EnsureSuccessStatusCode();

        var close = await ReceiveCloseAsync(socket);
        Assert.Equal(WebSocketMessageType.Close, close.MessageType);
        Assert.Equal(WebSocketCloseStatus.PolicyViolation, close.CloseStatus);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var cts = new CancellationTokenSource(ReceiveTimeout);
        while (!condition())
        {
            await Task.Delay(25, cts.Token);
        }
    }

    [Fact]
    public async Task Unauthenticated_Connection_IsRejected()
    {
        var (owner, _) = await RegisterAsync("relay.owner.c@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-c"))).AssertOkAsync();

        var wsClient = _factory.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = request => request.Headers["Origin"] = CadenceCors.DefaultOrigin;
        var uri = new UriBuilder(_factory.Server.BaseAddress) { Path = "/api/collab/relay-c" }.Uri;

        // No auth cookie → the authorization middleware rejects the upgrade (401),
        // so the handshake never completes.
        await Assert.ThrowsAnyAsync<Exception>(() => wsClient.ConnectAsync(uri, CancellationToken.None));
    }

    [Fact]
    public async Task Authenticated_NonOwner_WithoutToken_IsForbidden()
    {
        var (owner, _) = await RegisterAsync("relay.owner.d@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject("relay-d"))).AssertOkAsync();

        var (_, intruderCookie) = await RegisterAsync("relay.intruder.d@example.com");

        // Authenticated, but neither the owner nor a share-token holder → 403,
        // so the socket is never accepted.
        await Assert.ThrowsAnyAsync<Exception>(() => ConnectAsync(intruderCookie, "relay-d", token: null));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://malicious.example")]
    public async Task Authenticated_upgrade_with_missing_or_disallowed_origin_is_rejected(string? origin)
    {
        var (owner, cookie) = await RegisterAsync($"relay.origin.{Guid.NewGuid():N}@example.com");
        await (await owner.PostAsJsonAsync("/api/projects", NewProject($"origin-{Guid.NewGuid():N}"))).AssertOkAsync();
        var wsClient = _factory.Server.CreateWebSocketClient();
        wsClient.ConfigureRequest = request =>
        {
            request.Headers["Cookie"] = cookie;
            if (origin is not null)
            {
                request.Headers["Origin"] = origin;
            }
        };
        var uri = new UriBuilder(_factory.Server.BaseAddress)
        {
            Path = "/api/collab/does-not-matter",
        }.Uri;

        await Assert.ThrowsAnyAsync<Exception>(() => wsClient.ConnectAsync(uri, CancellationToken.None));
    }
}

internal static class HttpResponseAssertions
{
    /// <summary>Ensure a 2xx and return the response, for fluent test setup.</summary>
    public static Task<HttpResponseMessage> AssertOkAsync(this HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return Task.FromResult(response);
    }
}
