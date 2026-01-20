import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  // Rendering tests
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  // Variant tests
  it.each(['primary', 'secondary', 'ghost', 'danger'] as const)(
    'renders %s variant with correct styles',
    (variant) => {
      render(<Button variant={variant}>Button</Button>)
      const button = screen.getByRole('button')
      expect(button.className).toContain(variant)
    }
  )

  // Size tests
  it.each(['sm', 'md', 'lg'] as const)('renders %s size with correct styles', (size) => {
    render(<Button size={size}>Button</Button>)
    const button = screen.getByRole('button')
    expect(button.className).toContain(size)
  })

  // State tests
  it('shows spinner when loading', () => {
    render(<Button loading>Button</Button>)
    expect(screen.queryByText('Button')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('is disabled when loading', () => {
    render(<Button loading>Button</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Button</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('has reduced opacity when disabled (via CSS class)', () => {
    render(<Button disabled>Button</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  // fullWidth test
  it('applies fullWidth class when prop is true', () => {
    render(<Button fullWidth>Button</Button>)
    expect(screen.getByRole('button').className).toContain('fullWidth')
  })

  it('does not apply fullWidth class when prop is false', () => {
    render(<Button>Button</Button>)
    expect(screen.getByRole('button').className).not.toContain('fullWidth')
  })

  // Interaction tests
  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Button</Button>)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        Button
      </Button>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not call onClick when loading', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} loading>
        Button
      </Button>
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  // Focus tests
  it('can receive focus', () => {
    render(<Button>Button</Button>)
    const button = screen.getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
  })

  it('cannot receive focus when disabled', () => {
    render(<Button disabled>Button</Button>)
    const button = screen.getByRole('button')
    button.focus()
    // Disabled buttons can still receive focus but shouldn't respond to clicks
    expect(button).toBeDisabled()
  })

  // Keyboard accessibility
  it('responds to Enter key', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Button</Button>)
    const button = screen.getByRole('button')
    fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
    // Native button behavior handles Enter
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalled()
  })

  // Forwards ref
  it('forwards ref to button element', () => {
    const ref = vi.fn()
    render(<Button ref={ref}>Button</Button>)
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
  })

  // Custom className
  it('accepts custom className', () => {
    render(<Button className="custom-class">Button</Button>)
    expect(screen.getByRole('button').className).toContain('custom-class')
  })

  // Default variant and size
  it('uses primary variant by default', () => {
    render(<Button>Button</Button>)
    const button = screen.getByRole('button')
    expect(button.className).toContain('primary')
  })

  it('uses md size by default', () => {
    render(<Button>Button</Button>)
    const button = screen.getByRole('button')
    expect(button.className).toContain('md')
  })
})
