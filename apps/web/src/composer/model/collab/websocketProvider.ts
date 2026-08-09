/**
 * Default {@link CollabProviderFactory} backed by y-websocket. This is the only
 * module that talks to a real socket, so it is intentionally tiny and excluded
 * from unit coverage — the binding logic it feeds ({@link createCollabSession})
 * is fully tested with in-memory docs.
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { CollabConfig, CollabProvider } from './useCollaboration'

export function createWebsocketProvider(config: CollabConfig): CollabProvider {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(config.url, config.projectId, doc, {
    connect: true,
    // The relay authorizes the connection from the auth cookie + this token;
    // it never trusts a client-supplied role.
    params: config.token ? { token: config.token } : {},
  })
  return {
    doc,
    awareness: provider.awareness,
    onStatus: (listener) => {
      const handler = (event: { status: string }) => listener(event.status === 'connected')
      provider.on('status', handler)
      return () => provider.off('status', handler)
    },
    onSynced: (listener) => {
      const handler = (isSynced: boolean) => {
        if (isSynced) listener()
      }
      provider.on('sync', handler)
      return () => provider.off('sync', handler)
    },
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}
