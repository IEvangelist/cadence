import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

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

  it('toggles the pricing view from the nav', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Pricing' }))
    expect(
      screen.getByRole('heading', { name: 'Plans & pricing' }),
    ).toBeInTheDocument()
    // The toggle now offers a way back to the composer (nav + page both do).
    expect(
      screen.getAllByRole('button', { name: 'Back to composer' }).length,
    ).toBeGreaterThanOrEqual(1)
  })
})
