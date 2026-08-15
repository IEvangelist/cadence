import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { coversInteractions } from './test/coversInteractions'

describe('<App />', () => {
  it('renders the product name as a heading', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cadence' }),
    ).toBeInTheDocument()
  })

  it('renders the tagline', () => {
    render(<App />)
    expect(
      screen.getByText('AI-powered, cross-platform music studio'),
    ).toBeInTheDocument()
  })

  it('moves to the composer target from the skip link', async () => {
    coversInteractions('app.skip-to-composer')
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('link', { name: 'Skip to editor' }))

    expect(window.location.hash).toBe('#composer-main')
  })

  it('toggles the pricing view from the nav', async () => {
    coversInteractions('app.nav.pricing')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Pricing' }))
    expect(
      screen.getByRole('heading', { name: 'Plans & pricing' }),
    ).toBeInTheDocument()
    // The toggle now offers a way back to the composer (nav + page both do).
    expect(
      screen.getAllByRole('button', { name: 'Back to composer' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('toggles the standalone stems view from the nav', async () => {
    coversInteractions('app.nav.stems')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Stems' }))
    expect(
      screen.getByRole('heading', { name: 'Stem separation' }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Back to composer' }).length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('opens the third-party licenses surface from the footer', async () => {
    coversInteractions('app.nav.licenses')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Third-party licenses' }))
    expect(
      screen.getByRole('heading', {
        name: /acknowledgements & third-party licenses/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /lame project/i }),
    ).toHaveAttribute('href', 'https://lame.sourceforge.io/')
  })
})
