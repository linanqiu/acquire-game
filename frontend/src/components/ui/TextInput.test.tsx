import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  it('renders input element', () => {
    render(<TextInput />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders label when provided', () => {
    render(<TextInput label="Name" />)
    expect(screen.getByText('Name')).toBeInTheDocument()
  })

  it('associates label with input', () => {
    render(<TextInput label="Name" />)
    const input = screen.getByLabelText('Name')
    expect(input).toBeInTheDocument()
  })

  it('renders placeholder', () => {
    render(<TextInput placeholder="Enter name" />)
    expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument()
  })

  it('shows error message when provided', () => {
    render(<TextInput error="Required field" />)
    expect(screen.getByText('Required field')).toBeInTheDocument()
  })

  it('applies error styling when error provided', () => {
    render(<TextInput error="Error" />)
    // CSS modules hash class names, so check for partial match
    const input = screen.getByRole('textbox')
    expect(input.className).toMatch(/error/i)
  })

  it('sets aria-invalid when error provided', () => {
    render(<TextInput error="Error" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
  })

  it('respects maxLength', () => {
    render(<TextInput maxLength={4} />)
    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '4')
  })

  it('auto-capitalizes when autoCapitalize is true', () => {
    const onChange = vi.fn()
    render(<TextInput autoCapitalize onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'abcd' } })
    expect(onChange).toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('ABCD')
  })

  it('calls onChange when value changes', () => {
    const onChange = vi.fn()
    render(<TextInput onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('works without onChange', () => {
    render(<TextInput autoCapitalize />)
    const input = screen.getByRole('textbox')
    // Should not throw
    fireEvent.change(input, { target: { value: 'test' } })
    expect((input as HTMLInputElement).value).toBe('TEST')
  })

  it('can be disabled', () => {
    render(<TextInput disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('supports type attribute', () => {
    const { container } = render(<TextInput type="password" />)
    const passwordInput = container.querySelector('input[type="password"]')
    expect(passwordInput).toBeInTheDocument()
  })

  it('forwards ref to input element', () => {
    const ref = vi.fn()
    render(<TextInput ref={ref} />)
    expect(ref).toHaveBeenCalled()
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement)
  })
})
