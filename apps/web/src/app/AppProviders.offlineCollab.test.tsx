import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { useMemo, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthClient, Me } from '../auth/authClient'
import { useAuth } from '../auth/authContext'
import { buildCollabConfig } from '../composer/model/collab/collabConfig'
import { createEmptyProject, type Project } from '../composer/model/project'
import { serializeProject } from '../composer/model/persistence'
import { supportsCollaborationScope } from '../composer/model/syncingStore'
import { AppProviders } from './AppProviders'
import { useProjectStore } from './projectStoreContext'
import { handleAuthChange } from '../appStores'
import { registerCollaborationDatabase } from '../composer/model/collab/offlineCollabStorage'

const ada: Me = {
  id: 'account-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  tier: 'Free',
}
const bea: Me = {
  id: 'account-2',
  email: 'bea@example.com',
  displayName: 'Bea',
  tier: 'Free',
}

function authClient(me: () => Promise<Me | null>): AuthClient {
  return {
    me: vi.fn(me),
    providers: vi.fn(async () => []),
    login: vi.fn(async () => ada),
    register: vi.fn(async () => undefined),
    requestMagicLink: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
  } as unknown as AuthClient
}

function Harness() {
  const auth = useAuth()
  const appStore = useProjectStore()
  const [result, setResult] = useState('idle')
  const config = useMemo(
    () =>
      buildCollabConfig({
        search:
          '?collab=shared&owner=room-owner&role=editor&share=stable-grant',
        location: { protocol: 'https:', host: 'app.test' },
        user: auth.user,
        offlineUser: auth.offlineUser,
      }),
    [auth.offlineUser, auth.user],
  )
  const store = useMemo(
    () =>
      config && supportsCollaborationScope(appStore)
        ? appStore.forCollaboration(config)
        : null,
    [appStore, config],
  )
  const project = useMemo(() => {
    const value = createEmptyProject('shared')
    value.name = 'Owner backup'
    return value
  }, [])

  const save = () => {
    if (!store) return
    void (store.persist?.(project) ?? store.save(project))
      .then(() => setResult('saved'))
      .catch((error: Error) => setResult(`error:${error.message}`))
  }
  const load = () => {
    if (!store) return
    void store
      .loadLast()
      .then((loaded) => setResult(loaded?.name ?? 'missing'))
  }

  return (
    <>
      <output data-testid="auth-status">{auth.status}</output>
      <output data-testid="network-enabled">
        {String(config?.networkEnabled ?? false)}
      </output>
      <output data-testid="result">{result}</output>
      <button type="button" onClick={save}>save</button>
      <button type="button" onClick={load}>load</button>
      <button type="button" onClick={() => void auth.signOut()}>signout</button>
    </>
  )
}

function renderProviders(client: AuthClient) {
  return render(
    <MemoryRouter>
      <AppProviders authClient={client}>
        <Harness />
      </AppProviders>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
  await handleAuthChange({
    mode: 'anonymous',
    ownerId: null,
    purgeOwnerIds: ['account-1', 'account-2'],
  })
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AppProviders collaborative persistence wiring', () => {
  it('backs up remote autosave, reloads with every API unavailable, and isolates an account switch', async () => {
    let remoteProject: Project | null = null
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'https://app.test')
        const method = init?.method ?? 'GET'
        if (url.pathname === '/api/projects' && method === 'POST') {
          remoteProject = JSON.parse(String(init?.body)).data
            ? projectFromPayload(String(init?.body))
            : null
          return projectResponse(remoteProject!, 201)
        }
        if (url.pathname === '/api/projects' && method === 'GET') {
          return new Response(
            JSON.stringify(
              remoteProject
                ? [
                    {
                      id: remoteProject.id,
                      name: remoteProject.name,
                      schemaVersion: remoteProject.schemaVersion,
                      createdAt: '2026-01-01T00:00:00Z',
                      updatedAt: '2026-01-01T00:01:00Z',
                    },
                  ]
                : [],
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.pathname === '/api/projects/shared' && method === 'GET') {
          return remoteProject
            ? projectResponse(remoteProject)
            : new Response(null, { status: 404 })
        }
        return new Response(null, { status: 204 })
      },
    )
    vi.stubGlobal('fetch', fetchImpl)

    const online = renderProviders(authClient(async () => ada))
    await waitFor(() =>
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent('saved'),
    )
    expect((remoteProject as Project | null)?.name).toBe('Owner backup')
    expect(localStorage.getItem('cadence.v1.project.shared')).toBeNull()
    online.unmount()

    fetchImpl.mockImplementation(async () => {
      throw new TypeError('API unavailable')
    })
    const offline = renderProviders(
      authClient(async () => {
        throw new TypeError('Auth unavailable')
      }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('auth-status')).toHaveTextContent('offline'),
    )
    expect(screen.getByTestId('network-enabled')).toHaveTextContent('false')
    fetchImpl.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent('Owner backup'),
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    offline.unmount()

    const oldDatabaseName = 'cadence.collab.v1:account-1:old-account'
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(oldDatabaseName)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    registerCollaborationDatabase('account-1', oldDatabaseName)

    remoteProject = null
    fetchImpl.mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'https://app.test')
      if (url.pathname === '/api/projects' && (init?.method ?? 'GET') === 'GET') {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(null, { status: 404 })
    })
    renderProviders(authClient(async () => bea))
    await waitFor(() =>
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'load' }))
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent('missing'),
    )
    const accountOneBackupKeys = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith('cadence.collab.backup.v1:account-1:'))
    expect(accountOneBackupKeys).toEqual([])
    expect((await indexedDB.databases()).map((database) => database.name))
      .not.toContain(oldDatabaseName)
  })

  it('purges cached identity, serialized backup, and registered Yjs data on explicit sign-out', async () => {
    const project = createEmptyProject('shared')
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://app.test')
      const method = init?.method ?? 'GET'
      if (url.pathname === '/api/projects' && method === 'GET') {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.pathname === '/api/projects' && method === 'POST') {
        return projectResponse(project, 201)
      }
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    renderProviders(authClient(async () => ada))
    await waitFor(() =>
      expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() =>
      expect(screen.getByTestId('result')).toHaveTextContent('saved'),
    )

    const databaseName = 'cadence.collab.v1:account-1:registered'
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    registerCollaborationDatabase('account-1', databaseName)

    fireEvent.click(screen.getByRole('button', { name: 'signout' }))
    await waitFor(() =>
      expect(screen.getByTestId('auth-status')).toHaveTextContent('anonymous'),
    )

    const keys = Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.key(index) ?? '',
    )
    expect(keys.some((key) => key.includes('offline-identity'))).toBe(false)
    expect(
      keys.some((key) =>
        key.startsWith('cadence.collab.backup.v1:account-1:'),
      ),
    ).toBe(false)
    expect((await indexedDB.databases()).map((database) => database.name))
      .not.toContain(databaseName)
  })
})

function projectFromPayload(payload: string): Project {
  const body = JSON.parse(payload) as { data: string }
  return JSON.parse(body.data) as Project
}

function projectResponse(project: Project, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: project.id,
      name: project.name,
      schemaVersion: project.schemaVersion,
      data: serializeProject(project),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:01:00Z',
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}
