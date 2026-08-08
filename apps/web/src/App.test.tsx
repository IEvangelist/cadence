import { render, screen } from '@testing-library/react'
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
})
