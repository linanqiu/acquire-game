import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TextInput } from './TextInput'

describe('TextInput', () => {
  it('its label names the field, and an error is announced and marks the field invalid', () => {
    render(<TextInput label="Room code" error="No such game" />)
    const input = screen.getByLabelText('Room code')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('No such game')).toBeInTheDocument()
  })

  it('without an error the field is not marked invalid', () => {
    render(<TextInput label="Name" />)
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('typing a room code is upper-cased in the field and in what the page receives', () => {
    const onChange = vi.fn()
    render(<TextInput label="Room" autoCapitalize onChange={onChange} />)
    const input = screen.getByLabelText('Room')
    fireEvent.change(input, { target: { value: 'ab1d' } })
    expect(input.value).toBe('AB1D')
    expect(onChange.mock.calls[0][0].target.value).toBe('AB1D')
  })

  it('stops at maxLength', () => {
    render(<TextInput label="Room" maxLength={4} />)
    expect(screen.getByLabelText('Room')).toHaveAttribute('maxLength', '4')
  })
})
