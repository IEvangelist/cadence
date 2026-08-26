using System.Net.WebSockets;
using System.Security.Claims;
using System.Security.Cryptography;
using Cadence.Api.Collaboration;
using Cadence.Data;
using Cadence.Data.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Cadence.Api;

/// <summary>
/// Live-collaboration API: owner-only share-link management plus the WebSocket
/// relay that fans out Yjs updates between collaborators.
///
/// Authorization is server-authoritative and fails closed:
/// <list type="bullet">
/// <item>Every route requires authentication (identity from #7).</item>
/// <item>Share links are owner-scoped: only a project's owner may list, mint, or
/// revoke its links, and another user's project is a 404 (no existence leak).</item>
/// <item>A relay connection's role is derived server-side from ownership or a
/// DB-backed share token — never from a client claim. A viewer's document-write
/// frames are dropped before broadcast (see <see cref="RelayLoopAsync"/>), so a
/// read-only collaborator cannot mutate the shared document even with a tampered
/// client.</item>
/// </list>
/// </summary>
public static class CollaborationEndpoints
{
    /// <summary>Map the share-link CRUD group and the <c>/api/collab</c> relay.</summary>
    public static IEndpointRouteBuilder MapCadenceCollaboration(this IEndpointRouteBuilder app)
    {
        var shares = app
            .MapGroup("/api/projects/{projectId}/shares")
            .WithTags("Collaboration")
            .RequireAuthorization();

        shares.MapGet("/", ListSharesAsync);
        shares.MapPost("/", CreateShareAsync);
        shares.MapDelete("/{token}", RevokeShareAsync);

        // The relay is a WebSocket endpoint; authorization still applies, so an
        // unauthenticated upgrade is rejected before the socket is accepted.
        app.Map("/api/collab/{projectId}", RelayAsync).RequireAuthorization();

        return app;
    }

    private static async Task<IResult> ListSharesAsync(
        string projectId,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        if (!await OwnsProjectAsync(db, ownerId, projectId))
        {
            return Results.NotFound();
        }

        var links = await db.ProjectShareLinks
            .AsNoTracking()
            .Where(s => s.OwnerId == ownerId && s.ProjectId == projectId)
            .ToListAsync();

        var ordered = links.OrderBy(l => l.CreatedAt).Select(ToResponse).ToList();
        return Results.Ok(ordered);
    }

    private static async Task<IResult> CreateShareAsync(
        string projectId,
        CreateShareLinkRequest request,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        if (!await OwnsProjectAsync(db, ownerId, projectId))
        {
            return Results.NotFound();
        }

        if (!TryParseGrantableRole(request.Role, out var role))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["role"] = ["Role must be 'editor' or 'viewer'."],
            });
        }

        var link = new ProjectShareLink
        {
            Token = GenerateToken(),
            OwnerId = ownerId,
            ProjectId = projectId,
            Role = role,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.ProjectShareLinks.Add(link);
        await db.SaveChangesAsync();

        return Results.Created(
            $"/api/projects/{projectId}/shares/{link.Token}",
            ToResponse(link));
    }

    private static async Task<IResult> RevokeShareAsync(
        string projectId,
        string token,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db)
    {
        var ownerId = users.GetUserId(principal)!;
        var link = await db.ProjectShareLinks
            .FirstOrDefaultAsync(s => s.Token == token && s.OwnerId == ownerId && s.ProjectId == projectId);
        if (link is null)
        {
            return Results.NotFound();
        }

        db.ProjectShareLinks.Remove(link);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    private static async Task RelayAsync(
        HttpContext context,
        string projectId,
        ClaimsPrincipal principal,
        UserManager<ApplicationUser> users,
        CadenceDbContext db,
        CollabHub hub,
        ICollabDocumentStore documents,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        // Browsers do not apply CORS to WebSockets and cannot attach the antiforgery
        // header used by HTTP mutations. The browser-controlled Origin is therefore
        // the upgrade's CSRF boundary; missing and non-allow-listed origins fail closed.
        if (!CadenceCors.IsAllowedWebSocketOrigin(
                context.Request,
                configuration,
                allowLoopback: environment.IsDevelopment() || environment.IsEnvironment("Testing")))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        var callerId = users.GetUserId(principal);
        if (string.IsNullOrEmpty(callerId))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var (role, ownerId) = await ResolveRoleAsync(db, callerId, projectId, context.Request.Query["token"]);
        if (role is null)
        {
            // Authenticated but neither owner nor holder of a valid share token.
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        var room = RoomKey(ownerId, projectId);

        // Load the room's persisted document (if any) on first join, so a client
        // reconnecting after all peers left can be rehydrated from the server.
        var connection = await hub.JoinAsync(
            room,
            socket,
            role.Value,
            () => documents.LoadAsync(ownerId, projectId, context.RequestAborted),
            context.RequestAborted);
        try
        {
            await RelayLoopAsync(hub, room, connection, context.RequestAborted);
        }
        finally
        {
            // Persist the room's update log when its last peer leaves. Never
            // cancelled (RequestAborted is already tripped here) so edits survive.
            await hub.LeaveAsync(
                room,
                connection.Id,
                updates => documents.SaveAsync(ownerId, projectId, updates, CancellationToken.None));
        }
    }

    private static async Task RelayLoopAsync(
        CollabHub hub,
        string room,
        CollabConnection connection,
        CancellationToken cancellationToken)
    {
        var socket = connection.Socket;
        var buffer = new byte[32 * 1024];
        using var frame = new MemoryStream();

        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            frame.SetLength(0);
            WebSocketReceiveResult result;
            try
            {
                do
                {
                    result = await socket.ReceiveAsync(buffer, cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, null, cancellationToken);
                        return;
                    }

                    frame.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (WebSocketException)
            {
                return;
            }

            var message = frame.ToArray();

            // Server-side role enforcement: a viewer's document-write frames are
            // dropped here and never reach other peers. This is the authoritative
            // gate — the client cannot bypass it. Fail closed on malformed frames.
            if (!connection.CanWrite && YProtocol.IsWriteMessage(message))
            {
                continue;
            }

            // Answer a state request from the room's durable log so a reconnecting
            // collaborator (or the first client of a fresh room) converges from the
            // server — this is what lets a room survive all peers disconnecting.
            if (YProtocol.IsSyncStep1(message))
            {
                await SendSnapshotAsync(hub, room, connection, cancellationToken);
            }
            else if (YProtocol.TryReadUpdatePayload(message, out var payload))
            {
                // Capture every writer's document update so the room's persisted
                // state stays current for the next reconnect.
                hub.AppendUpdate(room, payload);
            }

            await hub.BroadcastAsync(room, connection.Id, message, cancellationToken);
        }
    }

    /// <summary>
    /// Replay the room's persisted document to a single connection: the first
    /// update as a sync step-2 (which also flips y-websocket to "synced", so the
    /// client adopts the shared document instead of reseeding from a stale local
    /// snapshot), the rest as incremental updates. A room with no persisted state
    /// gets an empty step-2, which still marks the fresh client synced so it seeds.
    /// </summary>
    private static async Task SendSnapshotAsync(
        CollabHub hub,
        string room,
        CollabConnection connection,
        CancellationToken cancellationToken)
    {
        var snapshot = hub.SnapshotUpdates(room);
        if (snapshot.Count == 0)
        {
            await connection.SendAsync(YProtocol.BuildSyncStep2(YProtocol.EmptyDocumentUpdate), cancellationToken);
            return;
        }

        for (var i = 0; i < snapshot.Count; i++)
        {
            var reply = i == 0
                ? YProtocol.BuildSyncStep2(snapshot[i])
                : YProtocol.BuildSyncUpdate(snapshot[i]);
            await connection.SendAsync(reply, cancellationToken);
        }
    }

    /// <summary>
    /// Resolve the caller's server-authoritative role on a project. Owners are
    /// implicit; everyone else must present a share token that maps to the same
    /// project. Returns <c>(null, "")</c> when access is denied.
    /// </summary>
    private static async Task<(CollaborationRole? Role, string OwnerId)> ResolveRoleAsync(
        CadenceDbContext db,
        string callerId,
        string projectId,
        string? token)
    {
        if (await OwnsProjectAsync(db, callerId, projectId))
        {
            return (CollaborationRole.Owner, callerId);
        }

        if (!string.IsNullOrEmpty(token))
        {
            var link = await db.ProjectShareLinks
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Token == token && s.ProjectId == projectId);
            if (link is not null)
            {
                return (link.Role, link.OwnerId);
            }
        }

        return (null, string.Empty);
    }

    private static Task<bool> OwnsProjectAsync(CadenceDbContext db, string ownerId, string projectId) =>
        db.Projects.AsNoTracking().AnyAsync(p => p.OwnerId == ownerId && p.Id == projectId);

    private static bool TryParseGrantableRole(string? value, out CollaborationRole role)
    {
        // Only editor/viewer may be granted via a link; owner is implicit and
        // never share-able. Unknown values fail closed.
        switch (value?.Trim().ToLowerInvariant())
        {
            case "editor":
                role = CollaborationRole.Editor;
                return true;
            case "viewer":
                role = CollaborationRole.Viewer;
                return true;
            default:
                role = CollaborationRole.Viewer;
                return false;
        }
    }

    private static string GenerateToken()
    {
        // 256 bits of entropy, URL-safe base64 (no padding) for a clean share URL.
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static string RoomKey(string ownerId, string projectId) => $"{ownerId}:{projectId}";

    private static ShareLinkResponse ToResponse(ProjectShareLink link) =>
        new(link.Token, link.OwnerId, link.Role.ToString().ToLowerInvariant(), link.CreatedAt);
}
