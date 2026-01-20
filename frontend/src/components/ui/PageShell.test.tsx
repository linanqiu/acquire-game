import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageShell } from './PageShell'

describe('PageShell', () => {
  it('renders children', () => {
    render(<PageShell>Page content</PageShell>)
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })

  it('renders header with logo by default', () => {
    render(<PageShell>Content</PageShell>)
    expect(screen.getByText('ACQUIRE')).toBeInTheDocument()
  })

  it('renders phase when provided', () => {
    render(<PageShell phase="Place Tile">Content</PageShell>)
    expect(screen.getByText('Place Tile')).toBeInTheDocument()
  })

  it('does not render phase when not provided', () => {
    render(<PageShell>Content</PageShell>)
    const phaseElement = screen.queryByText('Place Tile')
    expect(phaseElement).not.toBeInTheDocument()
  })

  it('renders footer when provided', () => {
    render(<PageShell footer={<button>Footer Action</button>}>Content</PageShell>)
    expect(screen.getByText('Footer Action')).toBeInTheDocument()
  })

  it('does not render footer when not provided', () => {
    render(<PageShell>Content</PageShell>)
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  })

  it('passes header props to Header component', () => {
    render(
      <PageShell roomCode="ABCD" cash={6000}>
        Content
      </PageShell>
    )
    expect(screen.getByText(/ABCD/)).toBeInTheDocument()
    expect(screen.getByText('$6,000')).toBeInTheDocument()
  })

  it('renders custom header when provided', () => {
    render(<PageShell header={<header>Custom Header</header>}>Content</PageShell>)
    expect(screen.getByText('Custom Header')).toBeInTheDocument()
    expect(screen.queryByText('ACQUIRE')).not.toBeInTheDocument()
  })

  it('renders null header when header is null', () => {
    render(<PageShell header={null}>Content</PageShell>)
    expect(screen.queryByText('ACQUIRE')).not.toBeInTheDocument()
  })
})
