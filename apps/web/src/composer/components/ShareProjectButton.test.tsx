import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
/* Interaction coverage:
 * studio.share.toggle, studio.share.create-editor, studio.share.create-viewer,
 * studio.share.copy, studio.share.revoke
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShareProjectButton } from './ShareProjectButton'
import { CollabShareClient, type ShareLink } from '../model/collab/collabClient'

const link = (token: string, role: ShareLink['role']): ShareLink => ({
  token,
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
    const client = fakeClient([link('t1', 'editor')])
    render(<ShareProjectButton projectId="p1" client={client} origin="https://app.test" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(screen.getByText('Editor')).toBeInTheDocument())
  })

  it.each(['editor', 'viewer'] as const)(
    'creates a %s link and copies it to the clipboard',
    async (role) => {
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

      await waitFor(() =>
        expect(clipboard).toHaveBeenCalledWith(
          `https://app.test/?collab=p1&role=${role}&share=tok-${role}`,
        ),
      )
      expect(client.create).toHaveBeenCalledWith('p1', role)
    },
  )

  it('copies an existing link and reports the copied state', async () => {
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
      'https://app.test/?collab=p1&role=editor&share=t1',
    )
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('revokes a link', async () => {
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
