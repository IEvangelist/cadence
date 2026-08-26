import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { ShareProjectButton } from './ShareProjectButton'
import { CollabShareClient, type ShareLink } from '../model/collab/collabClient'

const link = (token: string, role: ShareLink['role']): ShareLink => ({
  token,
  ownerId: 'owner-1',
  role,
  createdAt: '2024-01-01T00:00:00Z',
})

function fakeClient(initial: ShareLink[] = []) {
  const store = [...initial]
  return {
    list: vi.fn(async () => [...store]),
    create: vi.fn(async (_projectId: string, role: ShareLink['role']) => {
      const created = link(`tok-${role}`, role)
      store.push(created)
      return created
    }),
    revoke: vi.fn(async (_projectId: string, token: string) => {
      const idx = store.findIndex((l) => l.token === token)
      if (idx >= 0) store.splice(idx, 1)
    }),
  } as unknown as CollabShareClient
}

afterEach(() => vi.restoreAllMocks())

describe('ShareProjectButton', () => {
  it('loads existing links when opened', async () => {
    coversInteractions('studio.share.toggle')
    const client = fakeClient([link('t1', 'editor')])
    render(<ShareProjectButton projectId="p1" client={client} origin="https://app.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
  })

  async function createAndCopy(role: 'editor' | 'viewer') {
    const client = fakeClient()
    const clipboard = vi.fn(async () => {})
    const user = userEvent.setup()
    render(
      <ShareProjectButton
        projectId="p1"
        client={client}
        origin="https://app.test"
        clipboard={clipboard}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(
      await screen.findByRole('button', { name: `Create ${role} link` }),
    )

    await waitFor(() => {
      if (clipboard.mock.calls.length === 0) {
        throw new Error('Share link was not copied')
      }
    })
    return { client, clipboard }
  }

  it('creates an editor link and copies it to the clipboard', async () => {
    coversInteractions('studio.share.create-editor')
    const { client, clipboard } = await createAndCopy('editor')
    expect(client.create).toHaveBeenCalledWith('p1', 'editor')
    expect(clipboard).toHaveBeenCalledWith(
      'https://app.test/?collab=p1&owner=owner-1&role=editor&share=tok-editor',
    )
  })

  it('creates a viewer link and copies it to the clipboard', async () => {
    coversInteractions('studio.share.create-viewer')
    const { client, clipboard } = await createAndCopy('viewer')
    expect(client.create).toHaveBeenCalledWith('p1', 'viewer')
    expect(clipboard).toHaveBeenCalledWith(
      'https://app.test/?collab=p1&owner=owner-1&role=viewer&share=tok-viewer',
    )
  })

  it('copies an existing link and reports the copied state', async () => {
    coversInteractions('studio.share.copy')
    const client = fakeClient([link('t1', 'editor')])
    const clipboard = vi.fn(async () => {})
    const user = userEvent.setup()
    render(
      <ShareProjectButton
        projectId="p1"
        client={client}
        origin="https://app.test"
        clipboard={clipboard}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Share' }))
    await user.click(await screen.findByRole('button', { name: 'Copy link' }))

    expect(clipboard).toHaveBeenCalledWith(
      'https://app.test/?collab=p1&owner=owner-1&role=editor&share=t1',
    )
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('revokes a link', async () => {
    coversInteractions('studio.share.revoke')
    const client = fakeClient([link('t1', 'viewer')])
    render(<ShareProjectButton projectId="p1" client={client} origin="https://app.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(client.revoke).toHaveBeenCalledWith('p1', 't1'))
  })

  it('surfaces an error when loading fails', async () => {
    const client = {
      list: vi.fn(async () => {
        throw new Error('boom')
      }),
    } as unknown as CollabShareClient
    render(<ShareProjectButton projectId="p1" client={client} origin="https://app.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load share links.')
  })
})
