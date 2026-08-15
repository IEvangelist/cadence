import { fireEvent, render, screen, within } from '@testing-library/react'
/* Interaction coverage: licenses.external-link, licenses.close */
import { describe, expect, it, vi } from 'vitest'
import { AcknowledgementsPage } from './AcknowledgementsPage'

describe('<AcknowledgementsPage />', () => {
  it('renders the acknowledgements heading as a section region', () => {
    render(<AcknowledgementsPage />)
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: /acknowledgements & third-party licenses/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: /acknowledgements & third-party licenses/i }),
    ).toBeInTheDocument()
  })

  it('lists the @breezystack/lamejs LGPL-3.0-or-later entry with its version', () => {
    render(<AcknowledgementsPage />)

    // Rendered as a semantic table mirroring the docs "Licenses" table.
    const table = screen.getByRole('table', { name: /third-party components/i })
    expect(within(table).getByText('1.2.7')).toBeInTheDocument()
    expect(within(table).getByText('LGPL-3.0-or-later')).toBeInTheDocument()
    const packageLink = within(table).getByRole('link', {
      name: '@breezystack/lamejs',
    })
    expect(packageLink).toHaveAttribute(
      'href',
      'https://www.npmjs.com/package/@breezystack/lamejs',
    )
  })

  it('links to the LAME credit page at lame.sourceforge.io', () => {
    render(<AcknowledgementsPage />)
    const lame = screen.getByRole('link', { name: /lame project/i })
    expect(lame).toHaveAttribute('href', 'https://lame.sourceforge.io/')
  })

  it('cites the npm package and the upstream zhuker/lamejs fork lineage', () => {
    render(<AcknowledgementsPage />)
    // The package is cited in several places; every citation must point to npm.
    const npmLinks = screen.getAllByRole('link', { name: /@breezystack\/lamejs/i })
    expect(npmLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of npmLinks) {
      expect(link).toHaveAttribute(
        'href',
        'https://www.npmjs.com/package/@breezystack/lamejs',
      )
    }
    expect(screen.getByRole('link', { name: /zhuker\/lamejs/i })).toHaveAttribute(
      'href',
      'https://github.com/zhuker/lamejs',
    )
  })

  it('points to the full license text', () => {
    render(<AcknowledgementsPage />)
    const noticeLinks = screen.getAllByRole('link', {
      name: /third-party-notices\.md/i,
    })
    expect(noticeLinks.length).toBeGreaterThanOrEqual(1)
    for (const link of noticeLinks) {
      expect(link).toHaveAttribute(
        'href',
        'https://github.com/IEvangelist/cadence/blob/main/THIRD-PARTY-NOTICES.md',
      )
    }
    // The canonical LGPL text is reachable too.
    expect(screen.getByRole('link', { name: /lgpl-3\.0/i })).toHaveAttribute(
      'href',
      'https://www.gnu.org/licenses/lgpl-3.0.txt',
    )
  })

  it('invokes onClose from the back button', () => {
    const onClose = vi.fn()
    render(<AcknowledgementsPage onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /back to composer/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('omits the back button when no onClose is provided', () => {
    render(<AcknowledgementsPage />)
    expect(
      screen.queryByRole('button', { name: /back to composer/i }),
    ).not.toBeInTheDocument()
  })
})
