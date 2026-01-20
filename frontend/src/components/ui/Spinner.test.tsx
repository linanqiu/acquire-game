import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('renders with default medium size', () => {
    render(<Spinner />)
    const spinner = screen.getByRole('status')
    expect(spinner).toBeInTheDocument()
    expect(spinner.className).toContain('md')
  })

  it('renders with small size', () => {
    render(<Spinner size="sm" />)
    const spinner = screen.getByRole('status')
    expect(spinner.className).toContain('sm')
  })

  it('renders with large size', () => {
    render(<Spinner size="lg" />)
    const spinner = screen.getByRole('status')
    expect(spinner.className).toContain('lg')
  })

  it('has accessible loading text for screen readers', () => {
    render(<Spinner />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('applies spinner class', () => {
    render(<Spinner />)
    const spinner = screen.getByRole('status')
    expect(spinner.className).toContain('spinner')
  })
})
