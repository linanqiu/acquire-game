import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Select } from './Select'

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Option C' },
]

describe('Select', () => {
  it('renders all options', () => {
    render(<Select options={options} value="" onChange={() => {}} />)
    expect(screen.getByText('Option A')).toBeInTheDocument()
    expect(screen.getByText('Option B')).toBeInTheDocument()
    expect(screen.getByText('Option C')).toBeInTheDocument()
  })

  it('renders combobox role', () => {
    render(<Select options={options} value="" onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('renders placeholder when provided', () => {
    render(<Select options={options} value="" onChange={() => {}} placeholder="Select..." />)
    expect(screen.getByText('Select...')).toBeInTheDocument()
  })

  it('calls onChange with selected value', () => {
    const onChange = vi.fn()
    render(<Select options={options} value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('shows correct value as selected', () => {
    render(<Select options={options} value="b" onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toHaveValue('b')
  })

  it('is disabled when disabled prop is true', () => {
    render(<Select options={options} value="" onChange={() => {}} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('renders label when provided', () => {
    render(<Select options={options} value="" onChange={() => {}} label="Choose option" />)
    expect(screen.getByText('Choose option')).toBeInTheDocument()
  })

  it('associates label with select', () => {
    render(<Select options={options} value="" onChange={() => {}} label="Choose option" />)
    expect(screen.getByLabelText('Choose option')).toBeInTheDocument()
  })

  it('forwards ref to select element', () => {
    const ref = vi.fn()
    render(<Select ref={ref} options={options} value="" onChange={() => {}} />)
    expect(ref).toHaveBeenCalled()
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLSelectElement)
  })
})
