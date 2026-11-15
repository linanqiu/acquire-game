import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlashValue } from './FlashValue'

describe('FlashValue', () => {
  it('does not flash on first paint, flashes up or down when the number changes, keeps its text', () => {
    const at = (n: number) => (
      <FlashValue value={n} data-testid="cash">
        ${n}
      </FlashValue>
    )
    const { rerender } = render(at(100))
    const el = screen.getByTestId('cash')
    expect(el).not.toHaveAttribute('data-flash')
    rerender(at(600))
    expect(el).toHaveAttribute('data-flash', 'up')
    expect(el).toHaveTextContent('$600')
    rerender(at(200))
    expect(el).toHaveAttribute('data-flash', 'down')
    el.dispatchEvent(new Event('animationend'))
    expect(el).not.toHaveAttribute('data-flash')
    // Same value again: nothing.
    rerender(at(200))
    expect(el).not.toHaveAttribute('data-flash')
  })
})
