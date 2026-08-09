/**
 * Minimal Yjs relay for the Playwright e2e — a standalone Node stand-in for the
 * first-party C# relay (the web-e2e CI job has Node but no .NET). It maintains a
 * server-side Y.Doc per room so late joiners sync correctly, and it enforces the
 * SAME server-side role gate as the production relay: a viewer connection's
 * document-write frames (sync step2/update) are dropped and never reach peers,
 * while awareness/read frames flow. The role is resolved from the share token,
 * never from a client claim.
 *
 * Not shipped in the app bundle; used only by `playwright.config.ts`.
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const SYNC_STEP1 = 0
const SYNC_STEP2 = 1
const SYNC_UPDATE = 2

const port = Number(process.env.COLLAB_PORT ?? 4174)

// Fixed token → role map for the deterministic e2e. Unknown/absent tokens fail
// closed to the least-privileged role.
const ROLES = new Map([
  ['editor-token', 'editor'],
  ['viewer-token', 'viewer'],
])

/** @typedef {{ doc: Y.Doc, awareness: awarenessProtocol.Awareness, conns: Map<import('ws').WebSocket, Set<number>> }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map()

function getRoom(name) {
  let room = rooms.get(name)
  if (room) return room
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  room = { doc, awareness, conns: new Map() }

  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    const message = encoding.toUint8Array(encoder)
    for (const conn of room.conns.keys()) {
      if (conn !== origin) sendBinary(conn, message)
    }
  })

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    const message = encoding.toUint8Array(encoder)
    for (const conn of room.conns.keys()) {
      if (conn !== origin) sendBinary(conn, message)
    }
  })

  rooms.set(name, room)
  return room
}

function sendBinary(conn, message) {
  if (conn.readyState === conn.OPEN) {
    conn.send(message, { binary: true })
  }
}

const wss = new WebSocketServer({ noServer: true })

const httpServer = createServer((_request, response) => {
  // A tiny health endpoint so Playwright's webServer can detect readiness
  // (the raw WebSocket upgrade path is handled separately below).
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
})

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

wss.on('connection', (conn, request) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const roomName = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'default'
  const token = url.searchParams.get('token') ?? ''
  const role = ROLES.get(token) ?? 'viewer'
  const room = getRoom(roomName)
  room.conns.set(conn, new Set())

  conn.on('message', (data) => {
    const bytes = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(Buffer.from(data))
    const decoder = decoding.createDecoder(bytes)
    const messageType = decoding.readVarUint(decoder)

    if (messageType === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      const syncType = decoding.readVarUint(decoder)

      // Server-side role gate: viewers may read (step1) but never write.
      if (role === 'viewer' && (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE)) {
        return
      }

      if (syncType === SYNC_STEP1) {
        syncProtocol.readSyncStep1(decoder, encoder, room.doc)
        if (encoding.length(encoder) > 1) sendBinary(conn, encoding.toUint8Array(encoder))
      } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        syncProtocol.readSyncStep2(decoder, room.doc, conn)
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder)
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn)
      // Track which clients this connection controls, for cleanup on close.
      const controlled = room.conns.get(conn)
      if (controlled) {
        const changed = decodeAwarenessClients(update)
        for (const clientId of changed) controlled.add(clientId)
      }
    }
  })

  const close = () => {
    const controlled = room.conns.get(conn)
    room.conns.delete(conn)
    if (controlled && controlled.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...controlled], conn)
    }
    if (room.conns.size === 0) rooms.delete(roomName)
  }
  conn.on('close', close)
  conn.on('error', close)

  // Handshake: request the client's state, then push any current doc + awareness.
  const syncEncoder = encoding.createEncoder()
  encoding.writeVarUint(syncEncoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(syncEncoder, room.doc)
  sendBinary(conn, encoding.toUint8Array(syncEncoder))

  const states = room.awareness.getStates()
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    )
    sendBinary(conn, encoding.toUint8Array(awarenessEncoder))
  }
})

/** Peek the client ids carried by an awareness update (for disconnect cleanup). */
function decodeAwarenessClients(update) {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const ids = []
  for (let i = 0; i < count; i += 1) {
    const clientId = decoding.readVarUint(decoder)
    decoding.readVarUint(decoder) // clock
    decoding.readVarString(decoder) // state json
    ids.push(clientId)
  }
  return ids
}

httpServer.listen(port, '127.0.0.1', () => {
  console.log(`[collab-relay] listening on ws://127.0.0.1:${port}`)
})
