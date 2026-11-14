import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Portfolio } from './Portfolio'
import { snapshot, playerState } from '../../../tests/unit/fixtures/wire'

/** What the player page feeds Portfolio, from a real server state. */
function fromState(name) {
  const view = snapshot(name)
  const state = playerState(name)
  const me = state.players[view.human]
  const prices = Object.fromEntries(state.hotel.chains.map((c) => [c.name, c.price]))
  const holdings = Object.entries(me.stocks)
    .filter(([, q]) => q > 0)
    .map(([chain, quantity]) => ({ chain, quantity }))
  return { holdings, prices }
}

describe('Portfolio', () => {
  it('values each holding at the chain price and totals them', () => {
    const { holdings, prices } = fromState('buy-phase-multi-chain')
    expect(holdings.length).toBeGreaterThan(1)
    render(<Portfolio holdings={holdings} prices={prices} />)
    let total = 0
    for (const h of holdings) {
      const row = screen.getByTestId(`portfolio-row-${h.chain.toLowerCase()}`)
      const value = h.quantity * prices[h.chain]
      total += value
      expect(row).toHaveTextContent(`${h.quantity}`)
      expect(row).toHaveTextContent(`$${prices[h.chain].toLocaleString('en-US')}`)
      expect(row).toHaveTextContent(`$${value.toLocaleString('en-US')}`)
    }
    expect(screen.getByTestId('portfolio-total')).toHaveTextContent(
      `$${total.toLocaleString('en-US')}`
    )
  })

  it('leaves out chains the player holds none of, and the total can be hidden', () => {
    render(
      <Portfolio
        holdings={[
          { chain: 'Luxor', quantity: 3 },
          { chain: 'Tower', quantity: 0 },
        ]}
        prices={{ Luxor: 800, Tower: 700 }}
        showTotal={false}
      />
    )
    expect(screen.getByTestId('portfolio-row-luxor')).toBeInTheDocument()
    expect(screen.queryByTestId('portfolio-row-tower')).not.toBeInTheDocument()
    expect(screen.queryByTestId('portfolio-total')).not.toBeInTheDocument()
  })

  it('a player with no shares sees that, in the ruleset words', () => {
    render(<Portfolio holdings={[{ chain: 'Luxor', quantity: 0 }]} prices={{ Luxor: 800 }} />)
    expect(screen.getByTestId('portfolio-empty')).toHaveTextContent('No shares owned')
  })

  it('a chain that is not on the board (no price yet) is worth nothing, not NaN', () => {
    render(<Portfolio holdings={[{ chain: 'Luxor', quantity: 4 }]} prices={{}} />)
    expect(screen.getByTestId('portfolio-row-luxor')).toHaveTextContent('$0')
    expect(screen.getByTestId('portfolio-total')).toHaveTextContent('$0')
  })
})
