import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Hint } from './Hint'
import { hintSeen, markHintSeen } from '../../lib/hints'

describe('Hint: an instruction worth reading once', () => {
  beforeEach(() => localStorage.clear())

  it('is shown in full until the player has done the thing', () => {
    render(<Hint id="place">Pick a tile, then PLACE TILE.</Hint>)
    expect(screen.getByTestId('hint-place')).toHaveTextContent('Pick a tile, then PLACE TILE.')
    expect(screen.queryByTestId('hint-button-place')).not.toBeInTheDocument()
    expect(hintSeen('place')).toBe(false)
  })

  it('once seen it is a "?" button that brings the words back', () => {
    markHintSeen('trades')
    markHintSeen('trades') // twice is once
    expect(JSON.parse(localStorage.getItem('buyout-hints-seen')!)).toEqual(['trades'])
    render(<Hint id="trades">Offers are public.</Hint>)
    expect(screen.queryByText('Offers are public.')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'How this works' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(screen.getByTestId('hint-trades')).toHaveTextContent('Offers are public.')
  })

  it('`retire`: nothing at all once seen; other hints are not affected', () => {
    markHintSeen('place')
    const { container } = render(
      <Hint id="place" retire>
        Pick a tile.
      </Hint>
    )
    expect(container).toBeEmptyDOMElement()
    render(<Hint id="found">You get a free share.</Hint>)
    expect(screen.getByTestId('hint-found')).toBeInTheDocument()
  })

  it('unreadable storage leaves every hint visible', () => {
    localStorage.setItem('buyout-hints-seen', '{not json')
    expect(hintSeen('place')).toBe(false)
    render(<Hint id="place">Pick a tile.</Hint>)
    expect(screen.getByTestId('hint-place')).toBeInTheDocument()
  })
})
