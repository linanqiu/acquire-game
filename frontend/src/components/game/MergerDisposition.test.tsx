import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergerDisposition } from './MergerDisposition'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { DEFAULT_RS, VALLEY, MINI } from '../../../tests/unit/fixtures/rulesets'
import { snapshot } from '../../../tests/unit/fixtures/wire'

const sell = () => screen.getByTestId('slider-sell-to-bank')
const trade = () => screen.getByTestId(/^slider-trade-/)
// What each control gives is printed once, next to that control (BL-017).
const sold = () => screen.getByTestId('disposition-sell')
const traded = () => screen.getByTestId('disposition-trade')
const kept = () => screen.getByTestId('hold-display')
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
    expect(sold()).toHaveTextContent('0 → $0')
    expect(traded()).toHaveTextContent('0 → 0 ')
    expect(kept()).toHaveTextContent(/^5$/)
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(onConfirm).toHaveBeenCalledWith(0, 0, 5)
  })

  it('selling pays the merger price per share and leaves fewer to hold', () => {
    mount({ sharesOwned: 25, defunctPrice: 1200 })
    set(sell(), 25)
    expect(sold()).toHaveTextContent('25 → $30,000')
    expect(kept()).toHaveTextContent(/^0$/)
  })

  it('sell, trade and hold always add up to the shares owned, and confirm sends all three', () => {
    const { onConfirm } = mount({ sharesOwned: 10 })
    set(sell(), 3)
    set(trade(), 4)
    expect(kept()).toHaveTextContent(/^3$/)
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(onConfirm).toHaveBeenCalledWith(3, 4, 3)
  })

  it('trades go in pairs: an odd request rounds down, and every pair is one survivor share', () => {
    mount()
    set(trade(), 3)
    expect(traded()).toHaveTextContent('2 → 1 ')
    set(trade(), 6)
    expect(traded()).toHaveTextContent('6 → 3 ')
  })

  it('selling more takes shares back from a trade that no longer fits', () => {
    mount({ sharesOwned: 6 })
    set(trade(), 4)
    set(sell(), 5)
    expect(sold()).toHaveTextContent('5 → $2,500')
    expect(traded()).toHaveTextContent('0 → 0 ')
    expect(kept()).toHaveTextContent(/^1$/)
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
    expect(screen.getByTitle(`The price at the ${rs.theme.merger_noun}`)).toHaveTextContent(
      `at ${rs.theme.currency_symbol}500`
    )
    expect(
      screen.getByTitle(`Worth nothing until ${rs.chains[0].name} is founded again`)
    ).toBeInTheDocument()
    expect(trade()).toHaveAccessibleName(
      `${rs.chains[0].name} ${rs.theme.share_noun_plural} to trade 2 for 1 ${rs.chains[1].name}`
    )
    expect(traded()).toHaveTextContent(rs.chains[1].name)
  })

  it('says each number once: no summary line repeating the sliders', () => {
    mount({ sharesOwned: 10, defunctPrice: 500, cash: 3000 })
    set(sell(), 2)
    set(trade(), 6)
    expect(screen.queryByTestId('disposition-summary')).not.toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text.split('$1,000')).toHaveLength(2) // the sale, at the Sell slider
    expect(text.split('$4,000')).toHaveLength(2) // cash after, over the button
    expect(text).not.toMatch(/HOLD/)
  })

  it('shows the cash after the sale live, and reports the choice for the survivor table', () => {
    const drafts: unknown[] = []
    mount({
      sharesOwned: 10,
      defunctPrice: 500,
      cash: 3000,
      onDraftChange: (d: unknown) => drafts.push(d),
    })
    expect(screen.getByTestId('disposition-cash-after')).toHaveTextContent('Cash after $3,000')
    set(sell(), 2)
    set(trade(), 6)
    expect(screen.getByTestId('disposition-cash-after')).toHaveTextContent('Cash after $4,000')
    expect(traded()).toHaveTextContent('6 → 3 ')
    expect(drafts.at(-1)).toEqual({ sell: 2, trade: 6 })
  })

  it("the trade ratio is the ruleset's: at 3:1 the slider steps by three and three shares make one", () => {
    const rs = { ...DEFAULT_RS, merger_trade_ratio: 3 }
    mount({ sharesOwned: 10, survivorStockAvailable: 2 }, rs)
    expect(trade()).toHaveAttribute('step', '3')
    expect(trade()).toHaveAttribute('max', '6')
    set(trade(), 5)
    expect(traded()).toHaveTextContent('3 → 1 ')
    set(sell(), 8)
    expect(traded()).toHaveTextContent('0 → 0 ')
  })

  it('quick choices: sell all, trade the most the bank allows, keep all; the one in force is pressed', () => {
    const { onConfirm } = mount({ sharesOwned: 9, survivorStockAvailable: 3, defunctPrice: 500 })
    const keepAll = screen.getByTestId('disposition-keep-all')
    expect(keepAll).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('disposition-trade-max'))
    // 3 survivor shares in the bank: 6 traded, 3 kept.
    expect(trade()).toHaveValue('6')
    expect(traded()).toHaveTextContent('6 → 3')
    expect(kept()).toHaveTextContent(/^3$/)
    expect(screen.getByTestId('disposition-trade-max')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('disposition-sell-all'))
    expect(sold()).toHaveTextContent('9 → $4,500')
    expect(traded()).toHaveTextContent('0 → 0')
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(onConfirm).toHaveBeenCalledWith(9, 0, 0)
    fireEvent.click(keepAll)
    expect(kept()).toHaveTextContent(/^9$/)
  })

  it('trade max is off when nothing can be traded', () => {
    mount({ survivorStockAvailable: 0 })
    expect(screen.getByTestId('disposition-trade-max')).toBeDisabled()
  })

  it('over the button: my survivor shares and my place in the survivor after the trade', () => {
    mount({
      sharesOwned: 10,
      survivorStockAvailable: 10,
      myId: 'me',
      survivorHolders: [
        { player_id: 'a', shares: 5 },
        { player_id: 'me', shares: 2 },
        { player_id: 'b', shares: 3 },
      ],
    })
    const after = () => screen.getByTestId('disposition-survivor-after')
    expect(after()).toHaveTextContent('2 · 3rd, 1 behind')
    set(trade(), 2)
    expect(after()).toHaveTextContent('2→3 · would tie 2nd')
    set(trade(), 8)
    expect(after()).toHaveTextContent('2→6 · takes 1st')
  })
})
