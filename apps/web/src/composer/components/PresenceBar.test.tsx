import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PresenceBar } from './PresenceBar'
import type { CollabPresence } from '../model/collab/collabSession'

function person(overrides: Partial<CollabPresence> & { clientId: number }): CollabPresence {
  return {
    clientId: overrides.clientId,
    user: overrides.user ?? { id: `u${overrides.clientId}`, name: 'Ada Lovelace', color: '#3366ff' },
    cursor: overrides.cursor ?? null,
    isSelf: overrides.isSelf ?? false,
  }
}

describe('PresenceBar', () => {
  it('lists connected collaborators with self marked and ordered first', () => {
    render(
      <PresenceBar
        connected
        canWrite
        presence={[
          person({ clientId: 2, user: { id: 'b', name: 'Grace Hopper', color: '#ff8800' } }),
          person({ clientId: 1, user: { id: 'a', name: 'Ada Lovelace', color: '#3366ff' }, isSelf: true }),
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Ada Lovelace (you)')
    expect(items[1]).toHaveTextContent('Grace Hopper')
  })

  it('announces connection status politely', () => {
    render(<PresenceBar connected={false} canWrite presence={[person({ clientId: 1 })]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…')
    expect(screen.getByRole('status')).toHaveTextContent('1 person')
  })

  it('shows a read-only badge for viewers', () => {
    render(<PresenceBar connected canWrite={false} presence={[person({ clientId: 1 })]} />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })

  it('captions a collaborator cursor with the resolved track name and note count', () => {
    render(
      <PresenceBar
        connected
        canWrite
        resolveTrackName={(id) => (id === 't1' ? 'Lead' : undefined)}
        presence={[
          person({
            clientId: 3,
            user: { id: 'c', name: 'Kay', color: '#0a0' },
            cursor: { trackId: 't1', selectedNoteIds: ['n1', 'n2'] },
          }),
        ]}
      />,
    )
    expect(screen.getByText('editing Lead · 2 notes')).toBeInTheDocument()
  })

  it('renders avatar initials from the collaborator name', () => {
    render(
      <PresenceBar
        connected
        canWrite
        presence={[person({ clientId: 1, user: { id: 'a', name: 'Ada Lovelace', color: '#fff' } })]}
      />,
    )
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('picks a high-contrast avatar ink for hsl colors (a11y)', () => {
    // colorForId emits `hsl(h 70% 45%)`. A medium/light background needs dark
    // ink; a dark background needs white — always clearing WCAG AA (≥4.5:1).
    render(
      <PresenceBar
        connected
        canWrite
        presence={[
          person({ clientId: 1, user: { id: 'g', name: 'Green Bg', color: 'hsl(140 70% 45%)' } }),
          person({ clientId: 2, user: { id: 'b', name: 'Blue Bg', color: 'hsl(240 70% 45%)' } }),
        ]}
      />,
    )
    // Green (luminance ≈ 0.40) → dark ink; blue (luminance ≈ 0.09) → white ink.
    expect(screen.getByText('GB')).toHaveStyle({ color: 'rgb(0, 0, 0)' })
    expect(screen.getByText('BB')).toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })
})
