import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Browser, type Route } from '@playwright/test'
import { openStudioDestination } from './studioActions'
import { mockAntiforgery } from './mockAntiforgery'

// Live-collaboration e2e. Two authenticated browser contexts open the SAME
// project through a share link and sync over the standalone Yjs relay
// (`e2e/collab-server.mjs`, started by playwright.config). We prove:
//   1. two editors converge on a concurrent edit and see each other's presence,
//   2. a viewer link is read-only — it receives edits but its own writes never
//      reach the editor (server-side gate), and
//   3. the collaborative composer (with the presence bar) is axe-clean.
//
// There is no backend in e2e, so `/api/**` is mocked with `page.route`; the
// WebSocket relay is real and runs on its own port.

interface Identity {
  id: string
  email: string
  displayName: string
  tier: string
}

function mockApi(user: Identity) {
  let savedProject: Record<string, unknown> | null = null
  let signedIn = false
  let available = true
  let currentUser = user
  const blockedRequests: Array<{ method: string; path: string }> = []
  const handler = async (route: Route): Promise<void> => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    if (!available) {
      blockedRequests.push({ method, path })
      await route.abort('failed')
      return
    }
    if (await mockAntiforgery(route)) return
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/api/auth/me') return signedIn ? json(currentUser) : json({}, 401)
    if (path === '/api/auth/providers') return json({ providers: ['GitHub'] })
    if (path === '/api/auth/login' && method === 'POST') {
      signedIn = true
      return json(currentUser)
    }
    if (path === '/api/projects' && method === 'GET') {
      return json(
        savedProject
          ? [
              {
                ...savedProject,
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:01:00Z',
              },
            ]
          : [],
      )
    }
    if (/^\/api\/projects\/[^/]+$/.test(path) && method === 'GET') {
      return savedProject
        ? json({
            ...savedProject,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:01:00Z',
          })
        : json({}, 404)
    }
    if (path === '/api/projects' && method === 'POST') {
      savedProject = request.postDataJSON() as Record<string, unknown>
      return json(
        {
          ...savedProject,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:01:00Z',
        },
        201,
      )
    }
    if (/^\/api\/projects\/[^/]+$/.test(path) && method === 'PUT') {
      savedProject = request.postDataJSON() as Record<string, unknown>
      return json({
        ...savedProject,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:01:00Z',
      })
    }
    // Anything else the app calls (entitlements, saves): succeed emptily.
    return json({}, method === 'GET' ? 200 : 204)
  }
  return {
    handler,
    setAvailable(next: boolean) {
      available = next
    },
    setUser(next: Identity) {
      currentUser = next
    },
    blockedRequests,
  }
}

const TOKENS = { editor: 'editor-token', viewer: 'viewer-token' } as const
const WS_OFFLINE_KEY = 'cadence.e2e.collab-ws-offline'

async function openCollaborator(
  browser: Browser,
  user: Identity,
  role: 'editor' | 'viewer',
  room: string,
) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript((offlineKey) => {
    const NativeWebSocket = window.WebSocket
    const counts = { created: 0, closed: 0 }
    const sockets = new Set<WebSocket>()
    ;(window as unknown as { __CADENCE_WS_COUNTS__: typeof counts }).__CADENCE_WS_COUNTS__ =
      counts
    class CountingWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const blocked = window.localStorage.getItem(offlineKey) === '1'
        super(blocked ? 'ws://127.0.0.1:1/cadence-offline' : url, protocols)
        counts.created += 1
        sockets.add(this)
        this.addEventListener('close', () => {
          counts.closed += 1
          sockets.delete(this)
        })
      }
    }
    window.WebSocket = CountingWebSocket
    ;(
      window as unknown as {
        __CADENCE_SET_COLLAB_OFFLINE__: (offline: boolean) => void
      }
    ).__CADENCE_SET_COLLAB_OFFLINE__ = (offline) => {
      if (offline) {
        window.localStorage.setItem(offlineKey, '1')
        sockets.forEach((socket) => socket.close())
      } else {
        window.localStorage.removeItem(offlineKey)
      }
    }
  }, WS_OFFLINE_KEY)
  const api = mockApi(user)
  await page.route('**/api/**', api.handler)

  await page.goto(
    `/?collab=${room}&owner=e2e-owner&role=${role}&share=${TOKENS[role]}`,
  )

  await signInCollaborator(page, user)

  // Collaboration activates only once signed in + a share link is present.
  const roster = page.getByRole('region', { name: 'Collaborators' })
  await expect(roster).toBeVisible()
  return { context, page, roster, api }
}

async function signInCollaborator(
  page: import('@playwright/test').Page,
  user: Identity,
): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('correct horse battery')
  await page
    .getByRole('dialog', { name: 'Sign in to Cadence' })
    .getByRole('button', { name: 'Sign in' })
    .click()
  await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible()
}

const grid = (page: import('@playwright/test').Page) =>
  page.getByRole('application', { name: /Note grid/ })

/**
 * Add exactly one note via the keyboard: focus the grid, nudge the caret up two
 * semitones onto an empty pitch row, then press Enter. Deterministic regardless
 * of the demo content already on the track (unlike a pixel-positioned click).
 */
async function addNoteByKeyboard(page: import('@playwright/test').Page): Promise<void> {
  const g = grid(page)
  await g.focus()
  await g.press('ArrowUp')
  await g.press('ArrowUp')
  await g.press('Enter')
}

async function setCollabOffline(
  page: import('@playwright/test').Page,
  offline: boolean,
): Promise<void> {
  await page.evaluate((value) => {
    (
      window as unknown as {
        __CADENCE_SET_COLLAB_OFFLINE__: (offline: boolean) => void
      }
    ).__CADENCE_SET_COLLAB_OFFLINE__(value)
  }, offline)
}

async function indexeddbUpdateCount(
  page: import('@playwright/test').Page,
): Promise<number> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    const name = databases.find((database) =>
      database.name?.startsWith('cadence.collab.v1:'),
    )?.name
    if (!name) return 0
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const transaction = database.transaction('updates', 'readonly')
        const count = transaction.objectStore('updates').count()
        count.onerror = () => reject(count.error)
        count.onsuccess = () => resolve(count.result)
        transaction.oncomplete = () => database.close()
      }
    })
  })
}

test.describe('live collaboration', () => {
  test('two editors converge on an edit and see each other present', async ({ browser }) => {
    const room = `converge-${Date.now()}`
    const ada = await openCollaborator(
      browser,
      { id: 'u-ada', email: 'ada@example.com', displayName: 'Ada Editor', tier: 'Free' },
      'editor',
      room,
    )
    const bob = await openCollaborator(
      browser,
      { id: 'u-bob', email: 'bob@example.com', displayName: 'Bob Editor', tier: 'Free' },
      'editor',
      room,
    )

    // Presence: awareness propagates so each side lists two people.
    await expect(ada.roster).toContainText('2 people', { timeout: 15_000 })
    await expect(bob.roster).toContainText('2 people', { timeout: 15_000 })
    await expect(bob.roster).toContainText('Ada Editor')
    await expect(ada.roster).toContainText('Bob Editor')

    // Both editors adopt the same seeded project, so they view the same track
    // with the same starting note count. Capture it, then prove convergence by
    // deltas (the demo seed count is irrelevant to the assertion).
    const before = await ada.page.locator('.pr-note').count()
    await expect(bob.page.locator('.pr-note')).toHaveCount(before, { timeout: 15_000 })

    // Ada places a note; the CRDT update converges to Bob's canvas.
    await addNoteByKeyboard(ada.page)
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 1)
    await expect(bob.page.locator('.pr-note')).toHaveCount(before + 1, { timeout: 15_000 })

    // And it converges the other way too.
    await addNoteByKeyboard(bob.page)
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 2, { timeout: 15_000 })
    await expect(bob.page.locator('.pr-note')).toHaveCount(before + 2, { timeout: 15_000 })

    await ada.context.close()
    await bob.context.close()
  })

  test('a viewer link is read-only but still receives edits', async ({ browser }) => {
    const room = `viewer-${Date.now()}`
    const editor = await openCollaborator(
      browser,
      { id: 'u-ed', email: 'ed@example.com', displayName: 'Ed Editor', tier: 'Free' },
      'editor',
      room,
    )

    const before = await editor.page.locator('.pr-note').count()
    await addNoteByKeyboard(editor.page)
    await expect(editor.page.locator('.pr-note')).toHaveCount(before + 1)

    const viewer = await openCollaborator(
      browser,
      { id: 'u-viv', email: 'viv@example.com', displayName: 'Viv Viewer', tier: 'Free' },
      'viewer',
      room,
    )

    // The viewer sees the read-only badge and receives the editor's note.
    await expect(viewer.roster).toContainText('Read-only')
    await expect(viewer.page.locator('.pr-note')).toHaveCount(before + 1, { timeout: 15_000 })

    // A viewer's local edit must NOT reach the editor: the client never emits
    // write frames and the relay drops them server-side. The editor stays put.
    await addNoteByKeyboard(viewer.page)
    await editor.page.waitForTimeout(1500)
    await expect(editor.page.locator('.pr-note')).toHaveCount(before + 1)

    await editor.context.close()
    await viewer.context.close()
  })

  test('the collaborative composer is accessible', async ({ browser }) => {
    const room = `axe-${Date.now()}`
    const ada = await openCollaborator(
      browser,
      { id: 'u-axe', email: 'axe@example.com', displayName: 'Axe Tester', tier: 'Free' },
      'editor',
      room,
    )
    // A second collaborator so the presence roster renders multiple avatars.
    const bob = await openCollaborator(
      browser,
      { id: 'u-axe2', email: 'axe2@example.com', displayName: 'Bee Tester', tier: 'Free' },
      'editor',
      room,
    )
    await expect(ada.roster).toContainText('2 people', { timeout: 15_000 })

    const results = await new AxeBuilder({ page: ada.page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])

    await ada.context.close()
    await bob.context.close()
  })

  test('secondary routes close the socket and browser back reconnects once', async ({
    browser,
  }) => {
    const collaborator = await openCollaborator(
      browser,
      { id: 'u-route', email: 'route@example.com', displayName: 'Route Editor', tier: 'Free' },
      'editor',
      `route-${Date.now()}`,
    )
    await expect
      .poll(() =>
        collaborator.page.evaluate(
          () =>
            (window as unknown as {
              __CADENCE_WS_COUNTS__: { created: number; closed: number }
            }).__CADENCE_WS_COUNTS__,
        ),
      )
      .toMatchObject({ created: 1, closed: 0 })

    await openStudioDestination(collaborator.page, 'Pricing')
    await expect(collaborator.page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
    await expect
      .poll(() =>
        collaborator.page.evaluate(
          () =>
            (window as unknown as {
              __CADENCE_WS_COUNTS__: { created: number; closed: number }
            }).__CADENCE_WS_COUNTS__,
        ),
      )
      .toMatchObject({ created: 1, closed: 1 })

    await collaborator.page.goBack()
    await expect(collaborator.roster).toBeVisible()
    await expect
      .poll(() =>
        collaborator.page.evaluate(
          () =>
            (window as unknown as {
              __CADENCE_WS_COUNTS__: { created: number; closed: number }
            }).__CADENCE_WS_COUNTS__,
        ),
      )
      .toMatchObject({ created: 2, closed: 1 })

    await collaborator.context.close()
  })

  test('offline edits survive reload and converge after reconnect', async ({ browser }) => {
    const room = `offline-reload-${Date.now()}`
    const ada = await openCollaborator(
      browser,
      { id: 'u-offline', email: 'offline@example.com', displayName: 'Offline Ada', tier: 'Free' },
      'editor',
      room,
    )
    const bob = await openCollaborator(
      browser,
      { id: 'u-online', email: 'online@example.com', displayName: 'Online Bob', tier: 'Free' },
      'editor',
      room,
    )
    await expect(ada.roster).toContainText('2 people', { timeout: 15_000 })
    const before = await ada.page.locator('.pr-note').count()
    await expect(bob.page.locator('.pr-note')).toHaveCount(before)
    const persistedBefore = await indexeddbUpdateCount(ada.page)

    await setCollabOffline(ada.page, true)
    ada.api.setAvailable(false)
    await expect
      .poll(() =>
        ada.page.evaluate(
          () =>
            (window as unknown as {
              __CADENCE_WS_COUNTS__: { created: number; closed: number }
            }).__CADENCE_WS_COUNTS__.closed,
        ),
      )
      .toBeGreaterThan(0)

    await addNoteByKeyboard(ada.page)
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 1)
    await expect
      .poll(() => indexeddbUpdateCount(ada.page))
      .toBeGreaterThan(persistedBefore)

    await addNoteByKeyboard(bob.page)
    await expect(bob.page.locator('.pr-note')).toHaveCount(before + 1)

    await ada.page.reload()
    await expect(ada.page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(ada.roster).toBeVisible()
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 1, { timeout: 15_000 })
    await expect
      .poll(() =>
        ada.page.evaluate(
          () =>
            (window as unknown as {
              __CADENCE_WS_COUNTS__: { created: number; closed: number }
            }).__CADENCE_WS_COUNTS__.created,
        ),
      )
      .toBe(0)

    const reloadedPersistenceCount = await indexeddbUpdateCount(ada.page)
    await addNoteByKeyboard(ada.page)
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 2)
    await expect
      .poll(() => indexeddbUpdateCount(ada.page))
      .toBeGreaterThan(reloadedPersistenceCount)
    expect(
      ada.api.blockedRequests.filter(
        (request) =>
          request.path.startsWith('/api/projects') &&
          request.method !== 'GET',
      ),
    ).toEqual([])

    ada.api.setAvailable(true)
    await setCollabOffline(ada.page, false)
    await signInCollaborator(ada.page, {
      id: 'u-offline',
      email: 'offline@example.com',
      displayName: 'Offline Ada',
      tier: 'Free',
    })
    await expect(ada.page.locator('.pr-note')).toHaveCount(before + 3, { timeout: 30_000 })
    await expect(bob.page.locator('.pr-note')).toHaveCount(before + 3, { timeout: 30_000 })

    await ada.context.close()
    await bob.context.close()
  })
})
