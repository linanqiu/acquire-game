import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StockStepper } from './StockStepper'

const setup = (props) => {
  const onChange = vi.fn()
  render(<StockStepper max={10} onChange={onChange} {...props} />)
  return {
    onChange,
    inc: screen.getByTestId('stepper-increment'),
    dec: screen.getByTestId('stepper-decrement'),
    spin: screen.getByRole('spinbutton'),
  }
}

describe('StockStepper', () => {
  it('+ and - step by one and say where the stepper is for assistive tech', () => {
    const { onChange, inc, dec, spin } = setup({ value: 3, min: 1 })
    expect(spin).toHaveAttribute('aria-valuenow', '3')
    expect(spin).toHaveAttribute('aria-valuemin', '1')
    expect(spin).toHaveAttribute('aria-valuemax', '10')
    fireEvent.click(inc)
    expect(onChange).toHaveBeenLastCalledWith(4)
    fireEvent.click(dec)
    expect(onChange).toHaveBeenLastCalledWith(2)
  })

  it('cannot go above the maximum or below the minimum, with buttons or arrow keys', () => {
    const top = setup({ value: 10 })
    expect(top.inc).toBeDisabled()
    fireEvent.click(top.inc)
    fireEvent.keyDown(top.spin, { key: 'ArrowUp' })
    fireEvent.keyDown(top.spin, { key: 'ArrowRight' })
    expect(top.onChange).not.toHaveBeenCalled()
    expect(top.dec).not.toBeDisabled()
  })

  it('the lower bound: default 0, or the given minimum', () => {
    const { onChange, dec, spin } = setup({ value: 0 })
    expect(dec).toBeDisabled()
    fireEvent.click(dec)
    fireEvent.keyDown(spin, { key: 'ArrowDown' })
    fireEvent.keyDown(spin, { key: 'ArrowLeft' })
    expect(onChange).not.toHaveBeenCalled()
    cleanup()
    const custom = setup({ value: 2, min: 2 })
    expect(custom.dec).toBeDisabled()
  })

  it('arrow keys step the value (up/right add one, down/left remove one)', () => {
    const { onChange, spin } = setup({ value: 3 })
    for (const [key, next] of [
      ['ArrowUp', 4],
      ['ArrowRight', 4],
      ['ArrowDown', 2],
      ['ArrowLeft', 2],
    ]) {
      onChange.mockClear()
      fireEvent.keyDown(spin, { key })
      expect(onChange).toHaveBeenCalledWith(next)
    }
  })

  it('disabled (not my turn): neither buttons nor keys change anything, and it leaves the tab order', () => {
    const { onChange, inc, dec, spin } = setup({ value: 5, disabled: true })
    expect(inc).toBeDisabled()
    expect(dec).toBeDisabled()
    expect(spin).toHaveAttribute('tabIndex', '-1')
    fireEvent.keyDown(spin, { key: 'ArrowUp' })
    fireEvent.keyDown(spin, { key: 'ArrowDown' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a stepper whose bounds meet cannot move at all', () => {
    const { inc, dec } = setup({ value: 5, min: 5, max: 5 })
    expect(inc).toBeDisabled()
    expect(dec).toBeDisabled()
  })
})
