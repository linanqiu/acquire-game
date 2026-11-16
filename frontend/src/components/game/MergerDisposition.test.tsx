import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergerDisposition } from './MergerDisposition'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { DEFAULT_RS, VALLEY, MINI } from '../../../tests/unit/fixtures/rulesets'
import { snapshot } from '../../../tests/unit/fixtures/wire'

const sell = () => screen.getByTestId('slider-sell-to-bank')
const trade = () => screen.getByTestId(/^slider-trade-/)
const summary = () => screen.getByTestId('disposition-summary')
const set = (slider, value) => fireEvent.change(slider, { target: { value: String(value) } })

function mount(props = {}, rs = DEFAULT_RS) {
  const onConfirm = vi.fn()
  render(
    <RulesetScope ruleset={rs}>
      <MergerDisposition
        defunctChain={rs.chains[0].id}
        survivorChain={rs.chains[1].id}
        sharesOwned={6}
        defunctPrice={500}
        survivorStockAvailable={10}
        onConfirm={onConfirm}
        {...props}
      />
    </RulesetScope>
  )
  return { onConfirm }
}

describe('MergerDisposition', () => {
  it('starts holding everything: nothing sold or traded, and confirming sends exactly that', () => {
    const { onConfirm } = mount({ sharesOwned: 5 })
    expect(summary()).toHaveTextContent('SELL 0')
    expect(summary()).toHaveTextContent('TRADE 0')
    expect(summary()).toHaveTextContent('HOLD 5')
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(onConfirm).toHaveBeenCalledWith(0, 0, 5)
  })

  it('selling pays the merger price per share and leaves fewer to hold', () => {
    mount({ sharesOwned: 25, defunctPrice: 1200 })
    set(sell(), 25)
    expect(summary()).toHaveTextContent('SELL 25 (+$30,000)')
    expect(summary()).toHaveTextContent('HOLD 0')
  })

  it('sell, trade and hold always add up to the shares owned, and confirm sends all three', () => {
    const { onConfirm } = mount({ sharesOwned: 10 })
    set(sell(), 3)
    set(trade(), 4)
    expect(summary()).toHaveTextContent('HOLD 3')
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(onConfirm).toHaveBeenCalledWith(3, 4, 3)
  })

  it('trades go in pairs: an odd request rounds down, and every pair is one survivor share', () => {
    mount()
    set(trade(), 3)
    expect(summary()).toHaveTextContent('TRADE 2 (+1')
    set(trade(), 6)
    expect(summary()).toHaveTextContent('TRADE 6 (+3')
  })

  it('selling more takes shares back from a trade that no longer fits', () => {
    mount({ sharesOwned: 6 })
    set(trade(), 4)
    set(sell(), 5)
    expect(summary()).toHaveTextContent('SELL 5')
    expect(summary()).toHaveTextContent('TRADE 0')
    expect(summary()).toHaveTextContent('HOLD 1')
  })

  it('the trade limit follows the shares not sold: one share cannot be traded at 2:1', () => {
    mount({ sharesOwned: 1 })
    expect(trade()).toHaveAttribute('max', '0')
  })

  it('the trade limit is what the bank can hand out, whole shares only', () => {
    mount({ sharesOwned: 10, survivorStockAvailable: 2 })
    expect(trade()).toHaveAttribute('max', '4')
  })

  it('trading is switched off when the bank has no survivor shares left', () => {
    mount({ survivorStockAvailable: 0 })
    expect(trade()).toBeDisabled()
  })

  it('a real "trade limited by the bank" state: the trade slider stops at the engine max_trade', () => {
    const view = snapshot('disposition-trade-limited')
    const prompt = view.player.find((m) => m.type === 'stock_disposition_required')
    const { max_trade } = view.expect.decisions[0].legal
    mount({
      defunctChain: prompt.defunct_chain,
      survivorChain: prompt.surviving_chain,
      sharesOwned: prompt.stock_count,
      survivorStockAvailable: prompt.available_to_trade,
    })
    expect(trade()).toHaveAttribute('max', String(max_trade))
  })

  it.each([
    ['default', DEFAULT_RS],
    ['valley', VALLEY],
    ['mini', MINI],
  ])('%s: names the chains, shares and takeover in the ruleset words', (_name, rs) => {
    mount({}, rs)
    const text = document.body.textContent
    expect(text).toContain(`${rs.chains[0].name} ${rs.theme.share_noun_plural}`)
    expect(text).toContain(`price at ${rs.theme.merger_noun}`)
    expect(text).toContain(`count again only if ${rs.chains[0].name} is founded again`)
    expect(trade().closest('div').textContent).toContain(
      `TRADE 2:1 for ${rs.chains[1].name.toUpperCase()}`
    )
  })

  it('shows the cash after the sale and the survivor shares after the trade, live', () => {
    const drafts: unknown[] = []
    mount({
      sharesOwned: 10,
      defunctPrice: 500,
      cash: 3000,
      survivorShares: 4,
      onDraftChange: (d: unknown) => drafts.push(d),
    })
    expect(screen.getByTestId('disposition-cash-after')).toHaveTextContent('Cash after $3,000')
    expect(screen.getByTestId('disposition-survivor-after')).toHaveTextContent(/4$/)
    set(sell(), 2)
    set(trade(), 6)
    expect(screen.getByTestId('disposition-cash-after')).toHaveTextContent('Cash after $4,000')
    expect(screen.getByTestId('disposition-survivor-after')).toHaveTextContent('4 → 7')
    expect(drafts.at(-1)).toEqual({ sell: 2, trade: 6 })
  })

  it("the trade ratio is the ruleset's: at 3:1 the slider steps by three and three shares make one", () => {
    const rs = { ...DEFAULT_RS, merger_trade_ratio: 3 }
    mount({ sharesOwned: 10, survivorStockAvailable: 2 }, rs)
    expect(trade()).toHaveAttribute('step', '3')
    expect(trade()).toHaveAttribute('max', '6')
    set(trade(), 5)
    expect(summary()).toHaveTextContent('TRADE 3 (+1')
    set(sell(), 8)
    expect(summary()).toHaveTextContent('TRADE 0')
  })
})
