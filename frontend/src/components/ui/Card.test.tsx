import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText('Card content')).toBeInTheDocument()
  })

  it('renders title when provided', () => {
    render(<Card title="Card Title">Content</Card>)
    expect(screen.getByText('Card Title')).toBeInTheDocument()
  })

  it('does not render header when no title or onClose', () => {
    const { container } = render(<Card>Content</Card>)
    const header = container.querySelector('[class*="cardHeader"]')
    expect(header).not.toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<Card onClose={onClose}>Content</Card>)
    fireEvent.click(screen.getByText('×'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders close button with aria-label', () => {
    render(<Card onClose={() => {}}>Content</Card>)
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('renders footer when provided', () => {
    render(<Card footer={<button>Action</button>}>Content</Card>)
    expect(screen.getByText('Action')).toBeInTheDocument()
  })

  it('does not render footer when not provided', () => {
    const { container } = render(<Card>Content</Card>)
    const footer = container.querySelector('[class*="cardFooter"]')
    expect(footer).not.toBeInTheDocument()
  })

  it('renders title and close button together', () => {
    const onClose = vi.fn()
    render(
      <Card title="My Card" onClose={onClose}>
        Content
      </Card>
    )
    expect(screen.getByText('My Card')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    const { container } = render(<Card className="custom-class">Content</Card>)
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
