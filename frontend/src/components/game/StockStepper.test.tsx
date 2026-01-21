import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StockStepper } from './StockStepper'

describe('StockStepper', () => {
  // Rendering tests
  it('renders with current value', () => {
    render(<StockStepper value={3} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-value')).toHaveTextContent('3')
  })

  it('renders increment and decrement buttons', () => {
    render(<StockStepper value={3} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-decrement')).toBeInTheDocument()
    expect(screen.getByTestId('stepper-increment')).toBeInTheDocument()
  })

  it('has spinbutton role for accessibility', () => {
    render(<StockStepper value={3} max={10} onChange={() => {}} />)
    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
  })

  it('sets correct ARIA attributes', () => {
    render(<StockStepper value={3} min={1} max={10} onChange={() => {}} />)
    const stepper = screen.getByRole('spinbutton')
    expect(stepper).toHaveAttribute('aria-valuenow', '3')
    expect(stepper).toHaveAttribute('aria-valuemin', '1')
    expect(stepper).toHaveAttribute('aria-valuemax', '10')
  })

  // Increment tests
  it('calls onChange with incremented value when + clicked', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('stepper-increment'))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('disables + button when at max', () => {
    render(<StockStepper value={10} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-increment')).toBeDisabled()
  })

  it('does not call onChange when + clicked at max', () => {
    const onChange = vi.fn()
    render(<StockStepper value={10} max={10} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('stepper-increment'))
    expect(onChange).not.toHaveBeenCalled()
  })

  // Decrement tests
  it('calls onChange with decremented value when - clicked', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('stepper-decrement'))
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('disables - button when at min (default 0)', () => {
    render(<StockStepper value={0} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-decrement')).toBeDisabled()
  })

  it('disables - button when at custom min', () => {
    render(<StockStepper value={2} min={2} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-decrement')).toBeDisabled()
  })

  it('does not call onChange when - clicked at min', () => {
    const onChange = vi.fn()
    render(<StockStepper value={0} max={10} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('stepper-decrement'))
    expect(onChange).not.toHaveBeenCalled()
  })

  // Disabled state tests
  it('disables both buttons when disabled prop is true', () => {
    render(<StockStepper value={5} max={10} onChange={() => {}} disabled />)
    expect(screen.getByTestId('stepper-decrement')).toBeDisabled()
    expect(screen.getByTestId('stepper-increment')).toBeDisabled()
  })

  it('sets tabIndex to -1 when disabled', () => {
    render(<StockStepper value={5} max={10} onChange={() => {}} disabled />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('tabIndex', '-1')
  })

  it('sets tabIndex to 0 when not disabled', () => {
    render(<StockStepper value={5} max={10} onChange={() => {}} />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('tabIndex', '0')
  })

  // Keyboard navigation tests
  it('increments on ArrowUp', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('increments on ArrowRight', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('decrements on ArrowDown', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('decrements on ArrowLeft', () => {
    const onChange = vi.fn()
    render(<StockStepper value={3} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('does not increment past max with keyboard', () => {
    const onChange = vi.fn()
    render(<StockStepper value={10} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowUp' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not decrement past min with keyboard', () => {
    const onChange = vi.fn()
    render(<StockStepper value={0} max={10} onChange={onChange} />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not respond to keyboard when disabled', () => {
    const onChange = vi.fn()
    render(<StockStepper value={5} max={10} onChange={onChange} disabled />)
    const stepper = screen.getByRole('spinbutton')
    fireEvent.keyDown(stepper, { key: 'ArrowUp' })
    fireEvent.keyDown(stepper, { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  // Default values
  it('uses 0 as default min', () => {
    render(<StockStepper value={0} max={10} onChange={() => {}} />)
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-valuemin', '0')
    expect(screen.getByTestId('stepper-decrement')).toBeDisabled()
  })

  // Edge cases
  it('handles min equal to max', () => {
    const onChange = vi.fn()
    render(<StockStepper value={5} min={5} max={5} onChange={onChange} />)
    expect(screen.getByTestId('stepper-decrement')).toBeDisabled()
    expect(screen.getByTestId('stepper-increment')).toBeDisabled()
  })

  it('displays value of 0 correctly', () => {
    render(<StockStepper value={0} max={10} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-value')).toHaveTextContent('0')
  })

  it('displays large values correctly', () => {
    render(<StockStepper value={999} max={1000} onChange={() => {}} />)
    expect(screen.getByTestId('stepper-value')).toHaveTextContent('999')
  })
})
