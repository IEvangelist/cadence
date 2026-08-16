import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { createEmptyProject, createNote, createTrack, type Project } from './../project'
import { createCollabSession, type CollabSession } from './collabSession'

/**
 * An in-memory transport that mimics a relay: it forwards document + awareness
 * updates between two peers, and can be "disconnected" to exercise offline
 * edits and reconnect convergence — no real WebSocket involved.
 */
function connect(a: { doc: Y.Doc; awareness: Awareness }, b: { doc: Y.Doc; awareness: Awareness }) {
  let online = true
  const pendingDoc: Array<{ update: Uint8Array; to: Y.Doc; from: unknown }> = []

  const wireDoc = (from: Y.Doc, to: Y.Doc) => {
    from.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === to) return // don't reflect an update straight back
      if (online) Y.applyUpdate(to, update, from)
      else pendingDoc.push({ update, to, from })
    })
  }
  const wireAwareness = (from: Awareness, to: Awareness) => {
    from.on('update', ({ added, updated, removed }: Record<string, number[]>) => {
      if (!online) return
      const changed = [...added, ...updated, ...removed]
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), from)
    })
  }

  wireDoc(a.doc, b.doc)
  wireDoc(b.doc, a.doc)
  wireAwareness(a.awareness, b.awareness)
  wireAwareness(b.awareness, a.awareness)

  return {
    disconnect: () => {
      online = false
    },
    reconnect: () => {
      online = true
      for (const { update, to, from } of pendingDoc.splice(0)) Y.applyUpdate(to, update, from)
      // Re-exchange full state both ways so nothing is lost.
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), b.doc)
    },
  }
}

interface Peer {
  doc: Y.Doc
  awareness: Awareness
  session: CollabSession
  project: Project
}

const peers: Peer[] = []

function makePeer(
  name: string,
  seed: Project | undefined,
  opts: { canWrite?: boolean } = {},
): Peer {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const peer = {
    doc,
    awareness,
    project: seed ?? createEmptyProject('shared'),
  } as Peer
  peer.session = createCollabSession({
    doc,
    awareness,
    user: { id: name, name, color: '#abc' },
    canWrite: opts.canWrite ?? true,
    initialProject: seed,
    onRemoteProject: (project) => {
      peer.project = project
    },
  })
  peers.push(peer)
  return peer
}

afterEach(() => {
  for (const p of peers.splice(0)) p.session.destroy()
})

function seedProject(): Project {
  const project = createEmptyProject('shared')
  const track = createTrack({ name: 'Synth' }, 'track_a')
  track.notes = [createNote({ pitch: 60, start: 0 }, 'n1')]
  project.tracks = [track]
  return project
}

describe('createCollabSession', () => {
  it('converges two docs under concurrent, conflicting edits', () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    const link = connect(a, b)
    // B joins and syncs the seeded project from A.
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)
    void link

    // Concurrent edits: A adds a note, B renames the track — different fields.
    // A local edit updates local state directly (the reducer), then mirrors to
    // the doc; pushLocalProject is echo-safe so it won't call onRemoteProject.
    const aEdit = structuredClone(a.project)
    aEdit.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'n2'))
    a.project = aEdit
    a.session.pushLocalProject(aEdit)

    const bEdit = structuredClone(b.project)
    bEdit.tracks[0].name = 'Lead'
    b.project = bEdit
    b.session.pushLocalProject(bEdit)

    // Both peers converge to identical state.
    expect(a.project.tracks[0].name).toBe('Lead')
    expect(b.project.tracks[0].name).toBe('Lead')
    expect(a.project.tracks[0].notes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
    expect(b.project.tracks[0].notes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
  })

  it('sanitizes remote data through migrateProject', () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    // A pushes an out-of-range note directly into the doc.
    const evil = structuredClone(a.project)
    evil.tracks[0].notes[0].pitch = 9999
    evil.tracks[0].notes[0].velocity = 50
    a.session.pushLocalProject(evil)

    expect(b.project.tracks[0].notes[0].pitch).toBeLessThanOrEqual(127)
    expect(b.project.tracks[0].notes[0].velocity).toBeLessThanOrEqual(1)
  })

  it('replays offline edits on reconnect without losing data', () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    const link = connect(a, b)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    link.disconnect()

    const aEdit = structuredClone(a.project)
    aEdit.tracks[0].notes.push(createNote({ pitch: 64, start: 1 }, 'offlineA'))
    a.session.pushLocalProject(aEdit)

    const bEdit = structuredClone(b.project)
    bEdit.tracks[0].notes.push(createNote({ pitch: 55, start: 3 }, 'offlineB'))
    b.session.pushLocalProject(bEdit)

    // Diverged while offline.
    expect(a.project.tracks[0].notes.some((n) => n.id === 'offlineB')).toBe(false)

    link.reconnect()

    const ids = (p: Peer) => p.project.tracks[0].notes.map((n) => n.id).sort()
    expect(ids(a)).toEqual(['n1', 'offlineA', 'offlineB'])
    expect(ids(b)).toEqual(['n1', 'offlineA', 'offlineB'])
  })

  it('does not echo an unchanged project back into the doc', () => {
    const a = makePeer('A', seedProject())
    a.session.pushLocalProject(a.project)
    let updates = 0
    a.doc.on('update', () => {
      updates += 1
    })
    // Pushing the identical project must produce no Yjs ops.
    a.session.pushLocalProject(structuredClone(a.project))
    expect(updates).toBe(0)
  })

  it('reflects presence join and leave', () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)

    let roster: string[] = []
    a.session.onPresenceChange((present) => {
      roster = present.map((p) => p.user.name).sort()
    })
    b.session.announce()

    expect(roster).toEqual(['A', 'B'])

    b.session.destroy()
    expect(roster).toEqual(['A'])
  })

  it('does not write to the doc when the client is a viewer', () => {
    const a = makePeer('A', seedProject())
    const viewer = makePeer('V', undefined, { canWrite: false })
    connect(a, viewer)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(viewer.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    let updates = 0
    viewer.doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === viewer.session.localOrigin) updates += 1
    })
    const edit = structuredClone(viewer.project)
    edit.tracks[0].name = 'HackedByViewer'
    viewer.session.pushLocalProject(edit)

    expect(updates).toBe(0)
    expect(a.project.tracks[0].name).toBe('Synth')
  })

  it('seedIfEmpty seeds an empty doc once and never clobbers an existing one', () => {
    const a = makePeer('A', undefined) // constructed without a synchronous seed
    expect(a.doc.getMap('project').size).toBe(0)

    a.session.seedIfEmpty(seedProject())
    expect(a.doc.getMap('project').get('id')).toBe('shared')

    // A second call with a different project must not overwrite the seeded doc.
    a.session.seedIfEmpty(createEmptyProject('other'))
    expect(a.doc.getMap('project').get('id')).toBe('shared')
  })

  it('seedIfEmpty is a no-op for viewers', () => {
    const viewer = makePeer('V', undefined, { canWrite: false })
    viewer.session.seedIfEmpty(seedProject())
    expect(viewer.doc.getMap('project').size).toBe(0)
  })
})

describe('createCollabSession — collaborative undo/redo (#156)', () => {
  const idsOf = (p: Peer) => p.project.tracks[0].notes.map((n) => n.id)

  it("A's undo removes only A's edit; B's unrelated later edit survives A's undo AND redo", () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    // Enabled only AFTER the initial seed/sync (#156: seeding/adoption must
    // never itself be undoable).
    a.session.enableUndo()
    b.session.enableUndo()

    // A adds a note; B receives it via the live doc sync.
    const aEdit = structuredClone(a.project)
    aEdit.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'aNote'))
    a.project = aEdit
    a.session.pushLocalProject(aEdit)
    expect(idsOf(b)).toContain('aNote')

    // B makes its own, unrelated edit afterwards.
    const bEdit = structuredClone(b.project)
    bEdit.tracks[0].notes.push(createNote({ pitch: 72, start: 4 }, 'bNote'))
    b.project = bEdit
    b.session.pushLocalProject(bEdit)
    expect(idsOf(a)).toContain('bNote')

    // A undoes — only A's own note disappears on BOTH peers; B's later,
    // unrelated edit is preserved.
    a.session.undo()
    expect(idsOf(a).sort()).toEqual(['bNote', 'n1'])
    expect(idsOf(b).sort()).toEqual(['bNote', 'n1'])

    // A redoes — its own note comes back, B's edit is still untouched.
    a.session.redo()
    expect(idsOf(a).sort()).toEqual(['aNote', 'bNote', 'n1'])
    expect(idsOf(b).sort()).toEqual(['aNote', 'bNote', 'n1'])
  })

  it("undoes A's full velocity gesture while preserving B's later note", () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)
    a.session.enableUndo()
    b.session.enableUndo()

    for (const velocity of [0.6, 0.4, 0.2]) {
      const edit = structuredClone(a.project)
      edit.tracks[0].notes[0].velocity = velocity
      a.project = edit
      a.session.pushLocalProject(edit)
    }
    a.session.stopCapturing()

    const remote = structuredClone(b.project)
    remote.tracks[0].notes.push(createNote({ pitch: 72, start: 4 }, 'remote'))
    b.project = remote
    b.session.pushLocalProject(remote)
    expect(idsOf(a)).toContain('remote')

    a.session.undo()
    expect(a.project.tracks[0].notes.find((note) => note.id === 'n1')?.velocity).toBe(0.8)
    expect(idsOf(a)).toContain('remote')
    expect(idsOf(b)).toContain('remote')

    a.session.redo()
    expect(a.project.tracks[0].notes.find((note) => note.id === 'n1')?.velocity).toBe(0.2)
    expect(idsOf(a)).toContain('remote')
    expect(idsOf(b)).toContain('remote')
  })

  it("remote-only edits never populate a local client's undo stack", () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)
    a.session.enableUndo()

    // B edits; A only ever receives remote updates — it never writes locally.
    const bEdit = structuredClone(b.project)
    bEdit.tracks[0].notes.push(createNote({ pitch: 69, start: 3 }, 'bOnly'))
    b.project = bEdit
    b.session.pushLocalProject(bEdit)

    expect(idsOf(a)).toContain('bOnly')
    expect(a.session.canUndo()).toBe(false)
  })

  it('viewers never get undo/redo capability', () => {
    const a = makePeer('A', seedProject())
    const viewer = makePeer('V', undefined, { canWrite: false })
    connect(a, viewer)
    a.session.pushLocalProject(a.project)
    Y.applyUpdate(viewer.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    viewer.session.enableUndo() // no-op: viewers never write, so nothing to track
    expect(viewer.session.canUndo()).toBe(false)
    expect(viewer.session.canRedo()).toBe(false)
    expect(() => viewer.session.undo()).not.toThrow()
    expect(() => viewer.session.redo()).not.toThrow()
    expect(() => viewer.session.stopCapturing()).not.toThrow()
    expect(idsOf(viewer)).toEqual(['n1'])
  })

  it('does not make the initial seed itself undoable', () => {
    const a = makePeer('A', seedProject())
    a.session.enableUndo() // enabled AFTER the constructor's synchronous seed
    expect(a.session.canUndo()).toBe(false)
    a.session.undo() // no-op: nothing was captured
    expect(idsOf(a)).toEqual(['n1'])
  })

  it("a late joiner's adoption of the existing shared project is not undoable", () => {
    const a = makePeer('A', seedProject())
    const b = makePeer('B', undefined)
    connect(a, b)
    a.session.pushLocalProject(a.project)
    // B adopts A's already-seeded project purely via doc sync — no local write.
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), a.doc)

    b.session.enableUndo()
    expect(b.session.canUndo()).toBe(false)
  })

  it('a reconnect / project switch starts a brand-new session with no stale undo history', () => {
    const a = makePeer('A', seedProject())
    a.session.pushLocalProject(a.project)
    a.session.enableUndo()
    const edit = structuredClone(a.project)
    edit.tracks[0].notes.push(createNote({ pitch: 61, start: 1 }, 'stale'))
    a.project = edit
    a.session.pushLocalProject(edit)
    expect(a.session.canUndo()).toBe(true)

    // Simulate what `useCollaboration` does on a project/identity change:
    // destroy the old session and stand up a fresh doc + session for it.
    a.session.destroy()
    const freshDoc = new Y.Doc()
    const freshAwareness = new Awareness(freshDoc)
    const freshSession = createCollabSession({
      doc: freshDoc,
      awareness: freshAwareness,
      user: { id: 'A', name: 'A', color: '#abc' },
      canWrite: true,
      initialProject: seedProject(),
      onRemoteProject: () => {},
    })

    freshSession.enableUndo()
    expect(freshSession.canUndo()).toBe(false)
    freshSession.destroy()
  })

  it('replaces the shared project without retaining or creating undo history', () => {
    const a = makePeer('A', seedProject())
    a.session.enableUndo()
    const edit = structuredClone(a.project)
    edit.tracks[0].notes.push(createNote({ pitch: 64, start: 1 }, 'stale-local'))
    a.project = edit
    a.session.pushLocalProject(edit)
    expect(a.session.canUndo()).toBe(true)

    const replacement = createEmptyProject('replacement')
    replacement.name = 'Replacement'
    a.session.replaceLocalProject(replacement)
    expect(a.project.id).toBe('replacement')
    expect(a.session.canUndo()).toBe(false)
    expect(a.session.canRedo()).toBe(false)

    a.session.undo()
    expect(a.project.id).toBe('replacement')
    expect(a.project.tracks[0].notes).toHaveLength(0)
  })

  it('coalesces rapid same-origin updates into one undo step, with stopCapturing separating discrete commands', () => {
    const a = makePeer('A', seedProject())
    a.session.pushLocalProject(a.project)
    a.session.enableUndo()

    const noteId = 'dragNote'
    let edit = structuredClone(a.project)
    edit.tracks[0].notes.push(createNote({ pitch: 60, start: 0 }, noteId))
    a.project = edit
    a.session.pushLocalProject(edit)
    // Boundary: adding the note is a discrete command, distinct from the
    // continuous pointer-drag that follows it.
    a.session.stopCapturing()

    // Simulate a pointer-drag: several rapid updates to the SAME note's
    // `start`, with no boundary between them — these must coalesce.
    for (const start of [0.1, 0.2, 0.3]) {
      edit = structuredClone(a.project)
      edit.tracks[0].notes = edit.tracks[0].notes.map((n) =>
        n.id === noteId ? { ...n, start } : n,
      )
      a.project = edit
      a.session.pushLocalProject(edit)
    }
    expect(a.project.tracks[0].notes.find((n) => n.id === noteId)?.start).toBe(0.3)

    // ONE undo reverts the WHOLE drag (back to start: 0), not one step per
    // intermediate update.
    a.session.undo()
    expect(a.project.tracks[0].notes.find((n) => n.id === noteId)?.start).toBe(0)
    // The note-add is still a separate, undoable entry (kept apart by the
    // `stopCapturing` boundary above).
    expect(a.session.canUndo()).toBe(true)

    a.session.undo()
    expect(idsOf(a)).not.toContain(noteId)
  })
})
