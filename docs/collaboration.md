# Live collaboration (Yjs CRDT + presence)

Real-time, multi-user editing of a Cadence project. Concurrent edits from every
connected client merge deterministically and converge to the same result, remote
collaborators appear as live cursors/selections, and access is governed by
server-authoritative share roles (owner / editor / viewer).

Collaboration is **opt-in and inert by default** — nothing about the single-user
experience changes unless a session is explicitly activated (see
[Activation](#activation)). Signed-out, offline use keeps the existing versioned
`localStorage` seam untouched.

## At a glance

```
 Browser A (editor)          Browser B (viewer)
 ┌───────────────┐           ┌───────────────┐
 │ useComposer   │           │ useComposer   │
 │   reducer     │           │   reducer     │
 │      ▲ │      │           │      ▲ │      │
 │      │ ▼      │           │      │ ▼      │
 │ useCollaboration          │ useCollaboration
 │   Y.Doc  ⟷ awareness      │   Y.Doc  ⟷ awareness
 └──────┬────────┘           └──────┬────────┘
        │ WSS (y-protocol sync + awareness)
        ▼                           ▼
  ┌──────────────────────────────────────────┐
  │  Cadence.Api  ·  /api/collab/{projectId}  │
  │  per-connection auth → server role        │
  │  per-message gate: drop viewer writes ◄── authoritative
  │  fan-out to room peers ({ownerId}:{proj}) │
  └──────────────────────────────────────────┘
```

## CRDT project binding

The composer project is modelled as a nested [Yjs](https://github.com/yjs/yjs)
document (`apps/web/src/composer/model/collab/crdt.ts`):

- Project scalars (id, name, tempo, loop) live on a top-level `Y.Map`.
- `tracks` is a `Y.Array<Y.Map>`; each track's `notes` is a `Y.Array<Y.Map>`.

Because the structure is CRDT-native, two clients that concurrently insert,
move, or delete notes/tracks converge to an identical project without a central
merge step — that is the property the unit suite asserts (two docs, interleaved
ops → byte-for-byte identical read-back).

**The binding is two-way and echo-safe.** `useCollaboration`
(`.../collab/useCollaboration.ts`) subscribes to the existing `useComposer`
reducer:

- Local edits are mirrored into the `Y.Doc` inside an **origin-tagged**
  transaction (`pushLocalProject`).
- Remote `Y.Doc` updates are folded back into the reducer via a dedicated
  `sync-remote` action. The update handler ignores transactions carrying the
  local origin tag, so a local edit that round-trips through Yjs never
  re-applies to itself (no feedback loop).

### Sanitize seam (defense against hostile remotes)

A remote peer's `Y.Doc` update is untrusted input. Every read-back from the CRDT
is routed through the **existing** persistence sanitizer —
`migrateProject` / `coerceNote` in
`apps/web/src/composer/model/persistence.ts` — before it reaches the reducer.
Out-of-range pitches, `NaN`/`Infinity` timings, negative durations, and unknown
shapes are clamped or dropped exactly as they are for `localStorage` load. A
malicious client therefore cannot inject values the single-user path would have
rejected. This is covered by a "remote updates are sanitized" unit test.

### Deferred single-seed

When a client connects, it must not blindly push its local demo project into the
shared doc — if every joiner did, the room would accumulate duplicate tracks.
Instead the first client to observe an **empty** server doc seeds it (once,
guarded by `isProjectDocEmpty`) after the provider reports its initial sync;
later joiners adopt the shared project via the normal update path. The
local→doc mirror stays gated until that initial sync completes. In-memory/test
providers (no network sync step) seed synchronously, preserving the unit tests.

## Relay & transport

The relay is a **first-party ASP.NET Core WebSocket endpoint** inside
`Cadence.Api` at `/api/collab/{projectId}`, not a container.

Why first-party rather than an off-the-shelf `y-websocket` image: authorization
has to tie each connection **and each message** to the existing cookie identity
(effort #7) and the projects database. A generic relay container cannot enforce
per-message viewer read-only semantics against our identity/ownership model, and
there is no official, digest-pinnable `y-websocket` image we would trust for an
access-control boundary. The requirement explicitly permits "a small first-party
service", so there is **no container image to pin** — the transport is code we
own and test. (The Playwright e2e harness uses a throwaway Node relay under
`apps/web/e2e/collab-server.mjs`; it is a test fixture, never shipped.)

Transport details:

- Standard Yjs [sync protocol](https://github.com/yjs/y-protocols) (`step1` /
  `step2` / `update`) plus the awareness protocol, relayed verbatim between
  peers. The server is a message router; it does not need to materialize the
  document to enforce roles.
- Rooms are keyed `{ownerId}:{projectId}` so two users' identically-named
  projects never collide.
- Client transport lives in `.../collab/websocketProvider.ts` (a thin adapter
  over `y-websocket`'s `WebsocketProvider`) behind a `CollabProvider` seam, so
  tests inject an in-memory provider.

## Role enforcement (server-authoritative, fail closed)

Access control is treated as **security-sensitive**. Roles are
`Owner` / `Editor` / `Viewer` (`CollaborationRole`). Owner and editor may write;
viewer is strictly read-only. **The client is never trusted to enforce this.**

- **Roles are persisted server-side.** A `ProjectShareLink` row maps an opaque
  token → `{ projectId, ownerId, role }`. Owner-only CRUD lives at
  `/api/projects/{id}/shares` (`ListSharesAsync` / `CreateShareAsync` /
  `RevokeShareAsync`), each guarded by project ownership.
- **Connections are authenticated.** The relay endpoint is
  `RequireAuthorization()`, so an unauthenticated WebSocket upgrade is rejected
  before the socket is accepted.
- **Upgrades are origin-gated.** Browsers do not apply CORS to WebSockets and
  cannot add the HTTP antiforgery header. The relay therefore requires the
  browser-controlled `Origin` to match the API origin or an explicit
  `Cors:AllowedOrigins` entry. Missing and unlisted origins are rejected before
  `AcceptWebSocketAsync`, preventing cross-site WebSocket hijacking when
  `cadence.auth` uses `SameSite=None`. No token is put in a query string or log.
- Owner-only share-link `POST`/`DELETE` uses the normal antiforgery
  cookie + `X-CSRF-TOKEN` pair.
- **Role is resolved on the server**, never taken from a client claim.
  `ResolveRoleAsync` grants `Owner` when the caller owns the project, otherwise
  requires a share token that maps to the **same** project; anything else denies
  the connection (returns no role → the socket is not relayed). Fail closed.
- **Viewer writes are dropped at the message boundary.** This is the
  authoritative gate:

  > `CollaborationEndpoints.RelayLoopAsync` — for each inbound frame:
  > `if (!connection.CanWrite && YProtocol.IsWriteMessage(message)) continue;`

  `connection.CanWrite` is `Role != Viewer` (`CollabConnection.cs`).
  `YProtocol.IsWriteMessage` (`Collaboration/YProtocol.cs`) decodes the
  y-protocol varuint header and classifies sync `step2`(1) and `update`(2) as
  writes; **an undecodable/malformed frame is treated as a write and dropped**
  (fail closed). A dropped frame never reaches `hub.BroadcastAsync`, so a
  viewer's edit is invisible to every other peer and never lands in the shared
  document.

A viewer's UI may optimistically show its own keystroke (the composer reducer is
role-agnostic), but `pushLocalProject` no-ops for viewers **and** the server
gate drops the frame, so the edit is wiped on the next remote update. The e2e
suite proves this by asserting the *editor's* note count is unchanged after a
viewer attempts an edit.

## Presence

Presence rides the Yjs **awareness** protocol. Each client publishes a small
awareness state — display name, a stable per-user color, and the current
caret/selection (track + selected note ids). `PresenceBar.tsx` renders the live
roster (accessible avatars + names, a "Read-only" badge for viewers) and remote
carets/selections appear in the piano roll. Join/leave is reflected by awareness
add/remove events (covered by unit tests). Avatar ink is computed for
WCAG-compliant contrast against each generated color (axe-clean).

## Resilience (offline + reconnect)

Yjs updates are commutative and idempotent, so offline editing "just works":
a client that drops its socket keeps mutating its local `Y.Doc`, and on
reconnect the accumulated updates exchange in both directions and converge with
no lost edits. This is asserted by an "offline edits replay on reconnect" unit
test (buffer updates while disconnected, reconnect, assert convergence).

## Activation

Collaboration turns on only when the composer is given a collaboration config —
in the app via URL params, in tests via direct injection. The config carries the
relay URL, the project id, the authenticated user, the share token, and the
resolved role. Absent a config, `useCollaboration` returns an inert state and
the composer behaves exactly as the single-user build does.

The relay URL is supplied to the web build via the `VITE_COLLAB_URL`
environment variable (see the Aspire wiring in `src/Cadence.AppHost/AppHost.cs`).

## Durability (server-side document persistence)

Effort #91 adds a durable **server-side copy** of the shared document so a
collaboration room survives *all* peers disconnecting. Before this, the relay
(`CollabHub`) was a pure in-memory broadcaster that pruned a room the moment its
last peer left — the only durable copy of collaborative content lived in each
client's `localStorage` (autosave). A full-room drain followed by a reload could
therefore lose edits that had not yet mirrored to a client. Server persistence
closes that gap; client autosave is kept as the offline backstop — it writes a
different, per-client store and never races the shared document.

### Append-only update log (no server-side CRDT engine)

The server does **not** run a C# port of Yjs. Re-implementing the CRDT would risk
binary-interop drift against the pinned `yjs@13.6.31` client and add a
dependency/pinning burden. Instead the relay persists a **content-agnostic,
append-only log of the raw Yjs update payloads** it already relays:

- `CollabHub.JoinAsync` loads the saved log **once**, when the first peer joins a
  room (via a loader delegate backed by `ICollabDocumentStore`).
- `CollabHub.AppendUpdate` appends the payload of each **write** frame
  (sync `step2`/`update`, extracted by `YProtocol.TryReadUpdatePayload`) to the
  room's in-memory log as it is broadcast.
- `CollabHub.LeaveAsync` saves the log when the **last** peer leaves
  (save-on-empty, under `CancellationToken.None` so the write always completes),
  then prunes the room.

Because Yjs updates are commutative, idempotent, and associative, replaying the
whole log in order reconstructs the document regardless of duplicates — so the
log never needs de-duplication to be correct.

`CollabDocumentCodec` frames the list of updates into a single `byte[]` column
(`varUint(len) + bytes` per entry) and decodes it back, failing soft on a
truncated blob. `EfCollabDocumentStore` (a singleton that opens a scoped
`CadenceDbContext` per operation via `IServiceScopeFactory`) stores the blob in a
new **`CollaborationDocuments`** table keyed by `(OwnerId, ProjectId)` with a
cascade FK to the owning project — owner-scoped and IDOR-safe like every other
Cadence entity.

### Reactive rehydration (answering SyncStep1)

Rehydration is **reactive**, not proactive: the server never pushes an unsolicited
frame at join time. When a client opens the connection it sends the standard Yjs
**SyncStep1**; `CollaborationEndpoints.SendSnapshotAsync` answers it from the
durable log:

- **Non-empty log** → a `SyncStep2` carrying the first stored update, followed by a
  `SyncUpdate` for each remaining entry. The client applies them and converges to
  the persisted state.
- **Empty log** (fresh project) → a `SyncStep2` carrying the *empty-document*
  update (`[0x00, 0x00]`, the canonical `Y.encodeStateAsUpdate(new Y.Doc())`). This
  still flips the client to "synced" so the very first client seeds the doc.

Answering SyncStep1 (rather than injecting at join) is deliberate: it is invisible
to a client that is *not* asking to sync, which keeps the existing relay handshake
tests — none of which send SyncStep1 — byte-for-byte unaffected.

### Security: the viewer gate is unchanged and still first

Persistence sits **behind** the existing access-control gate. `RelayLoopAsync`
still drops viewer write-frames *before* anything else:

> `if (!connection.CanWrite && YProtocol.IsWriteMessage(message)) continue;`

Only frames that pass this gate can be appended to the log or broadcast, so a
viewer can never persist an edit. A viewer *can* send SyncStep1 and receive the
persisted state (read-only) — `IsWriteMessage` classifies SyncStep1 as a non-write
— and the role is still resolved server-side in `ResolveRoleAsync` (fail closed).

### Growth and compaction (follow-up)

The log is append-only, so a long-lived, heavily edited project accumulates updates
over its lifetime. This is correct but not yet space-optimal. Because the updates
are commutative/idempotent, a future compaction step can replace the whole log with
a single squashed update (materialize the doc, `encodeStateAsUpdate`, store one
entry) with **no** change to convergence semantics. That optimization is tracked as
a follow-up and is intentionally out of scope for #91, which establishes
correctness (survive all-peers-disconnect) first. The client-side `y-indexeddb`
offline-reload convergence enhancement remains a separate, complementary follow-up.
No secrets are involved — share tokens are per-project capability strings minted
and revoked through the owner-only API.

## Dependencies (pinned exact)

All collaboration packages are pinned to exact, latest-stable versions (no
`^`/`~`) with a committed lockfile (`npm ci`-clean):

| Package | Version |
|---|---|
| `yjs` | 13.6.31 |
| `y-websocket` | 3.0.0 |
| `y-protocols` | 1.0.7 |
| `lib0` | 0.2.117 |
| `ws` (e2e relay fixture) | 8.21.1 |

`@tensorflow/tfjs` and `@tensorflow/tfjs-backend-webgl` remain at 2.8.6
(untouched). Because the relay is first-party code, there is no image tag or
digest to pin.

## Source map

| Concern | File |
|---|---|
| CRDT ↔ project binding | `apps/web/src/composer/model/collab/crdt.ts` |
| Reducer sync seam | `apps/web/src/composer/model/collab/collabSession.ts` |
| React hook / lifecycle | `apps/web/src/composer/model/collab/useCollaboration.ts` |
| WebSocket provider | `apps/web/src/composer/model/collab/websocketProvider.ts` |
| Share-link API client | `apps/web/src/composer/model/collab/collabClient.ts` |
| Presence UI | `apps/web/src/composer/components/PresenceBar.tsx` |
| Share UI | `apps/web/src/composer/components/ShareProjectButton.tsx` |
| Sanitize seam (reused) | `apps/web/src/composer/model/persistence.ts` |
| Relay + share CRUD | `src/Cadence.Api/CollaborationEndpoints.cs` |
| Per-message gate / hub | `src/Cadence.Api/Collaboration/CollabConnection.cs`, `CollabHub.cs` |
| Write classifier | `src/Cadence.Api/Collaboration/YProtocol.cs` |
| Share-link entity | `ProjectShareLink` (`src/Cadence.Data`) |

See [`architecture.md`](architecture.md) for where this sits in the system and
[`testing.md`](testing.md) for the collaboration test matrix.
