import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RadioGroup } from './RadioGroup'

const options = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'maybe', label: 'Maybe' },
]

describe('RadioGroup', () => {
  it('renders all options', () => {
    render(<RadioGroup name="test" options={options} value="" onChange={() => {}} />)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('Maybe')).toBeInTheDocument()
  })

  it('has radiogroup role for accessibility', () => {
    render(<RadioGroup name="test" options={options} value="" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
  })

  it('renders radio inputs', () => {
    render(<RadioGroup name="test" options={options} value="" onChange={() => {}} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
  })

  it('has correct option selected', () => {
    render(<RadioGroup name="test" options={options} value="yes" onChange={() => {}} />)
    const yesRadio = screen.getByLabelText('Yes')
    const noRadio = screen.getByLabelText('No')
    expect(yesRadio).toBeChecked()
    expect(noRadio).not.toBeChecked()
  })

  it('calls onChange when option selected', () => {
    const onChange = vi.fn()
    render(<RadioGroup name="test" options={options} value="" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('No'))
    expect(onChange).toHaveBeenCalledWith('no')
  })

  it('all radios share the same name attribute', () => {
    render(<RadioGroup name="my-group" options={options} value="" onChange={() => {}} />)
    const radios = screen.getAllByRole('radio')
    radios.forEach((radio) => {
      expect(radio).toHaveAttribute('name', 'my-group')
    })
  })

  it('renders label when provided', () => {
    render(<RadioGroup name="test" options={options} value="" onChange={() => {}} label="Choose" />)
    expect(screen.getByText('Choose')).toBeInTheDocument()
  })

  it('disables all radios when disabled prop is true', () => {
    render(<RadioGroup name="test" options={options} value="" onChange={() => {}} disabled />)
    const radios = screen.getAllByRole('radio')
    radios.forEach((radio) => {
      expect(radio).toBeDisabled()
    })
  })

  it('clicking label selects radio', () => {
    const onChange = vi.fn()
    render(<RadioGroup name="test" options={options} value="" onChange={onChange} />)
    fireEvent.click(screen.getByText('Maybe'))
    expect(onChange).toHaveBeenCalledWith('maybe')
  })
})
