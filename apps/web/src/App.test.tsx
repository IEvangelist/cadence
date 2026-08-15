import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { createAppMemoryRouter } from './app/router'
import { LocalStorageProjectStore, MemoryStorage } from './composer/model/storage'
import { coversInteractions } from './test/coversInteractions'

describe('<App />', () => {
  const renderApp = (path = '/') =>
    render(
      <App
        router={createAppMemoryRouter(
          [path],
          new LocalStorageProjectStore(new MemoryStorage()),
        )}
      />,
    )

  it('renders the product name as a heading', async () => {
    renderApp()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Cadence' }, { timeout: 5_000 }),
    ).toBeInTheDocument()
  })

  it('renders the tagline', async () => {
    renderApp()
    expect(
      await screen.findByText('AI-powered, cross-platform music studio'),
    ).toBeInTheDocument()
  })

  it('moves to the composer target from the skip link', async () => {
    coversInteractions('app.skip-to-composer')
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('link', { name: 'Skip to editor' }))

    expect(window.location.hash).toBe('#composer-main')
  })

  it('toggles the pricing view from the nav', async () => {
    coversInteractions('app.nav.pricing')
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Pricing' }))
    expect(await screen.findByRole('heading', { name: 'Plans & pricing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to composer' })).toBeInTheDocument()
  })

  it('toggles the standalone stems view from the nav', async () => {
    coversInteractions('app.nav.stems')
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Stems' }))
    expect(await screen.findByRole('heading', { name: 'Stem separation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to composer' })).toBeInTheDocument()
  })

  it('opens the third-party licenses surface from the footer', async () => {
    coversInteractions('app.nav.licenses')
    const user = userEvent.setup()
    renderApp()
    await user.click(await screen.findByRole('button', { name: 'Third-party licenses' }))
    expect(
      await screen.findByRole('heading', {
        name: /acknowledgements & third-party licenses/i,
      }, { timeout: 5_000 }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /lame project/i }),
    ).toHaveAttribute('href', 'https://lame.sourceforge.io/')
  })

  it('persists a selected theme from the shared menu', async () => {
    coversInteractions('app.theme.open', 'app.theme.select')
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Choose theme' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark theme' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('cadence.v1.theme')).toBe('dark')
  })

  it('returns an unknown route to Studio', async () => {
    coversInteractions('app.not-found.studio')
    const user = userEvent.setup()
    renderApp('/missing')
    await user.click(await screen.findByRole('button', { name: 'Return to Studio' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Composer' })).toBeInTheDocument(),
    )
  })
})
