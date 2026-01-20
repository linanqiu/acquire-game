import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders home page by default', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /acquire/i })).toBeInTheDocument()
  })

  it('has navigation link to lobby', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: /enter lobby/i })).toBeInTheDocument()
  })
})
