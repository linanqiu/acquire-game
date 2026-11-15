import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ChainSelector } from './ChainSelector'
import { chainName, chainsByTier } from '../../lib/ruleset'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { DEFAULT_RS, MINI, VALLEY } from '../../../tests/unit/fixtures/rulesets'
import { snapshot, playerState, playedGame } from '../../../tests/unit/fixtures/wire'

const btn = (chain) => screen.getByTestId(`chain-button-${chain.toLowerCase()}`)

/** A real "found a chain" prompt: the chains the server offers, and what the bank holds. */
function founding() {
  const view = snapshot('found-chain-choice')
  const offered = view.player.find((m) => m.type === 'choose_chain').available_chains
  const state = playerState('found-chain-choice')
  return { offered, stock: state.hotel.available_stocks }
}

describe('ChainSelector', () => {
  it('founding: the offered chains are choosable, the ones already on the board are marked ACTIVE and locked', () => {
    const { offered, stock } = founding()
    const onSelect = vi.fn()
    render(
      <ChainSelector availableChains={offered} stockAvailability={stock} onSelect={onSelect} />
    )
    for (const c of DEFAULT_RS.chains.map((x) => x.id)) {
      if (offered.includes(c)) {
        expect(btn(c)).not.toBeDisabled()
        expect(btn(c)).toHaveTextContent(`${stock[c]} shares left`)
        expect(btn(c)).toHaveAttribute(
          'aria-label',
          `${chainName(DEFAULT_RS, c)}, ${stock[c]} shares left`
        )
      } else {
        expect(btn(c)).toBeDisabled()
        expect(btn(c)).toHaveTextContent('ACTIVE')
        expect(btn(c)).toHaveAttribute('aria-label', `${chainName(DEFAULT_RS, c)}, already active`)
      }
    }
    fireEvent.click(btn(offered[0]))
    expect(onSelect).toHaveBeenCalledWith(offered[0])
    const locked = DEFAULT_RS.chains.map((x) => x.id).find((c) => !offered.includes(c))
    fireEvent.click(btn(locked))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('a survivor tie: only the tied chains are choosable, the others say NOT TIED', () => {
    const view = snapshot('merger-survivor-tie')
    const tied = view.player.find((m) => m.type === 'choose_merger_survivor').tied_chains
    const onSelect = vi.fn()
    render(
      <ChainSelector
        availableChains={tied}
        stockAvailability={playerState('merger-survivor-tie').hotel.available_stocks}
        onSelect={onSelect}
        unavailableLabel="NOT TIED"
      />
    )
    const group = screen.getByRole('radiogroup')
    const enabled = within(group)
      .getAllByRole('radio')
      .filter((r) => !r.disabled)
    expect(enabled).toHaveLength(tied.length)
    const other = DEFAULT_RS.chains.map((x) => x.id).find((c) => !tied.includes(c))
    expect(btn(other)).toHaveTextContent('NOT TIED')
    expect(btn(other)).toHaveAttribute('aria-label', `${chainName(DEFAULT_RS, other)}, not tied`)
  })

  it('a chain whose shares the bank has sold out can still be founded (the founder gets a free one)', () => {
    const onSelect = vi.fn()
    render(
      <ChainSelector
        availableChains={['sandpiper']}
        stockAvailability={{ sandpiper: 0 }}
        onSelect={onSelect}
      />
    )
    expect(btn('sandpiper')).toHaveTextContent('0 shares left')
    fireEvent.click(btn('sandpiper'))
    expect(onSelect).toHaveBeenCalledWith('sandpiper')
  })

  it('without a count the bank is full: the ruleset bank size', () => {
    render(
      <ChainSelector availableChains={['sandpiper']} stockAvailability={{}} onSelect={() => {}} />
    )
    expect(btn('sandpiper')).toHaveTextContent(`${DEFAULT_RS.stocks_per_chain} shares left`)
  })

  describe('keyboard', () => {
    const mount = (available = ['sandpiper', 'marlowe']) => {
      const onSelect = vi.fn()
      render(
        <ChainSelector availableChains={available} stockAvailability={{}} onSelect={onSelect} />
      )
      return onSelect
    }

    it('arrow keys move through the chains that can be chosen, skipping locked ones, and wrap around', () => {
      // Focus order is the display order: chains grouped by tier, cheapest tier first.
      const order = chainsByTier(DEFAULT_RS).flatMap((t) => t.chains.map((c) => c.id))
      // Offer the 1st, 4th and 7th: the others are locked (disabled buttons cannot take focus).
      const offered = [order[0], order[3], order[6]]
      mount(offered)
      const [a, b, c] = offered.map(btn)
      a.focus()
      fireEvent.keyDown(a, { key: 'ArrowRight' })
      expect(b).toHaveFocus()
      fireEvent.keyDown(b, { key: 'ArrowDown' })
      expect(c).toHaveFocus()
      fireEvent.keyDown(c, { key: 'ArrowRight' })
      expect(a).toHaveFocus()
      fireEvent.keyDown(a, { key: 'ArrowLeft' })
      expect(c).toHaveFocus()
      fireEvent.keyDown(c, { key: 'ArrowUp' })
      expect(b).toHaveFocus()
    })

    it('with a single chain on offer the arrows stay on it', () => {
      mount(['marlowe'])
      btn('marlowe').focus()
      fireEvent.keyDown(btn('marlowe'), { key: 'ArrowRight' })
      expect(btn('marlowe')).toHaveFocus()
    })

    it('Enter and Space choose the focused chain, but never a chain that is not on offer', () => {
      const onSelect = mount()
      fireEvent.keyDown(btn('sandpiper'), { key: 'Enter' })
      fireEvent.keyDown(btn('sandpiper'), { key: ' ' })
      expect(onSelect).toHaveBeenCalledTimes(2)
      fireEvent.keyDown(btn('halcyon'), { key: 'Enter' })
      expect(onSelect).toHaveBeenCalledTimes(2)
    })
  })

  describe('other rulesets', () => {
    it('valley: its own tiers, chain names, share noun, and no default words', () => {
      const state = playedGame('valley').states['found_chain/found_chain']
      const offered = state.hotel.chains
        .map((c) => c.name)
        .filter((n) => !state.hotel.active_chains.includes(n))
      render(
        <RulesetScope ruleset={state.ruleset}>
          <ChainSelector
            availableChains={offered}
            stockAvailability={state.hotel.available_stocks}
            onSelect={() => {}}
          />
        </RulesetScope>
      )
      for (const tier of VALLEY.tiers) expect(screen.getByText(tier.label)).toBeInTheDocument()
      expect(screen.getAllByRole('radio')).toHaveLength(VALLEY.chains.length)
      expect(screen.getByRole('radiogroup').textContent).toMatch(/equity shares left/)
      expect(screen.getByRole('radiogroup').textContent).not.toMatch(/Sandpiper|Marlowe|hotel/i)
    })

    it('mini: five chains and an 18-share bank', () => {
      render(
        <RulesetScope ruleset={MINI}>
          <ChainSelector
            availableChains={['sandpiper']}
            stockAvailability={{}}
            onSelect={() => {}}
          />
        </RulesetScope>
      )
      expect(screen.getAllByRole('radio')).toHaveLength(5)
      expect(btn('sandpiper')).toHaveTextContent('18 shares left')
    })
  })
})
