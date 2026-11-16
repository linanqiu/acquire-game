import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TradeBuilder } from './TradeBuilder'
import { snapshot, playerState } from '../../../tests/unit/fixtures/wire'

/** The props the player page builds from a real server state (same shape as PlayerPage). */
function propsFrom(name = 'buy-phase-multi-chain') {
  const view = snapshot(name)
  const state = playerState(name)
  const me = state.players[view.human]
  const players = Object.entries(state.players)
    .filter(([id]) => id !== view.human)
    .map(([id, p]) => ({
      id,
      name: p.name,
      cash: p.money,
      stocks: p.stocks,
      isBot: p.is_bot,
      kind: p.kind,
      agentLabel: p.agent_label,
    }))
  const myHoldings = Object.entries(me.stocks)
    .filter(([, q]) => q > 0)
    .map(([chain, quantity]) => ({ chain, quantity }))
  return { players, myHoldings, myCash: me.money }
}

function mount(extra = {}) {
  const props = propsFrom()
  const onPropose = vi.fn()
  const onCancel = vi.fn()
  render(<TradeBuilder {...props} onPropose={onPropose} onCancel={onCancel} {...extra} />)
  const partner = props.players.find((p) => p.cash >= 5000)
  return { ...props, onPropose, onCancel, partner }
}

const pick = (p) => fireEvent.click(screen.getByTestId(`player-select-${p.id}`))
const offerRow = (chain) => within(screen.getByTestId(`offer-stock-${chain}`))
const wantRow = (chain) => within(screen.getByTestId(`want-stock-${chain}`))
const click = (el, n = 1) => {
  for (let i = 0; i < n; i++) fireEvent.click(el)
}
const error = () => screen.getByTestId('trade-error').textContent

describe('TradeBuilder', () => {
  it('lists the other players with their cash; a partner is needed before anything can be requested', () => {
    const { players } = mount()
    for (const p of players) {
      const button = screen.getByTestId(`player-select-${p.id}`)
      expect(button).toHaveTextContent(p.name)
      expect(button).toHaveTextContent(`$${p.cash.toLocaleString('en-US')}`)
    }
    expect(screen.queryByTestId('want-cash-input')).not.toBeInTheDocument()
    expect(screen.getByText(/Select a trade partner/)).toBeInTheDocument()
  })

  it('refuses a proposal step by step: partner, then something offered, then something requested', () => {
    const { partner, onPropose } = mount()
    const propose = () => fireEvent.click(screen.getByTestId('propose-trade'))
    propose()
    expect(error()).toBe('Select a trade partner')
    pick(partner)
    propose()
    expect(error()).toBe('You must offer something')
    fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: '100' } })
    propose()
    expect(error()).toBe('You must request something')
    expect(onPropose).not.toHaveBeenCalled()
  })

  it('the stock steppers stop at what I hold and at what the partner holds', () => {
    const { myHoldings, partner } = mount()
    pick(partner)
    const mine = myHoldings[0]
    click(offerRow(mine.chain).getByTestId('stepper-increment'), mine.quantity + 3)
    expect(offerRow(mine.chain).getByTestId('stepper-value')).toHaveTextContent(
      String(mine.quantity)
    )
    expect(offerRow(mine.chain).getByTestId('stepper-increment')).toBeDisabled()
    const [chain, theirs] = Object.entries(partner.stocks).find(([, q]) => q > 0)
    click(wantRow(chain).getByTestId('stepper-increment'), theirs + 3)
    expect(wantRow(chain).getByTestId('stepper-value')).toHaveTextContent(String(theirs))
  })

  it('a negative or non-numeric cash amount counts as nothing offered', () => {
    const { partner, onPropose } = mount()
    pick(partner)
    for (const typed of ['-40', 'abc']) {
      fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: typed } })
      fireEvent.click(screen.getByTestId('propose-trade'))
      expect(error()).toBe('You must offer something')
    }
    expect(onPropose).not.toHaveBeenCalled()
  })

  it('a proposal carries the partner, the stocks and the cash of both sides', () => {
    const { myHoldings, partner, onPropose } = mount()
    pick(partner)
    const mine = myHoldings[0]
    click(offerRow(mine.chain).getByTestId('stepper-increment'), 2)
    const [chain] = Object.entries(partner.stocks).find(([, q]) => q > 0)
    click(wantRow(chain).getByTestId('stepper-increment'))
    fireEvent.change(screen.getByTestId('offer-cash-input'), { target: { value: '300' } })
    fireEvent.change(screen.getByTestId('want-cash-input'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [{ chain: mine.chain, quantity: 2 }], cash: 300 },
      { stocks: [{ chain, quantity: 1 }], cash: 100 }
    )
  })

  it('cash for cash is a valid trade, and amounts above what each side has are clamped to it', () => {
    const { myCash, partner, onPropose } = mount()
    pick(partner)
    fireEvent.change(screen.getByTestId('offer-cash-input'), {
      target: { value: String(myCash + 999) },
    })
    fireEvent.change(screen.getByTestId('want-cash-input'), {
      target: { value: String(partner.cash + 999) },
    })
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [], cash: myCash },
      { stocks: [], cash: partner.cash }
    )
  })

  it('choosing another partner clears what I had asked the first one for', () => {
    const { players, partner } = mount()
    pick(partner)
    const [chain] = Object.entries(partner.stocks).find(([, q]) => q > 0)
    click(wantRow(chain).getByTestId('stepper-increment'))
    expect(wantRow(chain).getByTestId('stepper-value')).toHaveTextContent('1')
    pick(players.find((p) => p !== partner))
    for (const v of screen.getAllByTestId('stepper-value')) {
      if (v.closest('[data-testid^="want-stock-"]')) expect(v).toHaveTextContent('0')
    }
  })

  it('a change after an error clears the message', () => {
    const { partner } = mount()
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(error()).toBeTruthy()
    pick(partner)
    expect(screen.queryByTestId('trade-error')).not.toBeInTheDocument()
  })

  it('a player with no shares is said to have none; so am I', () => {
    const view = propsFrom('trade-incoming')
    const poor = view.players.find((p) => Object.values(p.stocks).every((q) => q === 0))
    render(<TradeBuilder {...view} onPropose={() => {}} onCancel={() => {}} />)
    expect(screen.getByText('You have no shares to offer')).toBeInTheDocument()
    pick(poor)
    expect(screen.getByText(`${poor.name} has no shares`)).toBeInTheDocument()
  })

  it("shows the server's refusal and the notice, and cannot be submitted while a proposal is in flight", () => {
    mount({
      serverError: 'Cannot trade Sandpiper stock during its merger',
      notice: 'A merger is on',
      submitting: true,
    })
    expect(error()).toBe('Cannot trade Sandpiper stock during its merger')
    expect(screen.getByText('A merger is on')).toBeInTheDocument()
    expect(screen.getByTestId('propose-trade')).toBeDisabled()
  })

  it('CANCEL leaves the builder (the sheet around it has the close button)', () => {
    const { onCancel } = mount()
    fireEvent.click(screen.getByTestId('cancel-trade'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('opens on a starting point (a competing offer): partner, both sides and the note; all editable', () => {
    const props = propsFrom()
    const partner = props.players.find((p) => p.cash >= 5000)
    const [mine] = props.myHoldings
    const onPropose = vi.fn()
    render(
      <TradeBuilder
        {...props}
        onPropose={onPropose}
        onCancel={vi.fn()}
        startedFrom="Started from Cara's offer to Bob."
        initial={{
          partnerId: partner.id,
          offer: { stocks: [{ chain: mine.chain, quantity: 1 }], cash: 0 },
          want: { stocks: [], cash: 600 },
        }}
      />
    )
    expect(screen.getByTestId('trade-started-from')).toHaveTextContent(
      "Started from Cara's offer to Bob."
    )
    expect(screen.getByTestId(`player-select-${partner.id}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(offerRow(mine.chain).getByTestId('stepper-value')).toHaveTextContent('1')
    expect(screen.getByTestId('want-cash-input')).toHaveValue(600)
    expect(screen.getByTestId('offer-cash-input')).toHaveValue(null)
    // It is only a start: change the price, then send.
    fireEvent.change(screen.getByTestId('want-cash-input'), { target: { value: '500' } })
    fireEvent.click(screen.getByTestId('propose-trade'))
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [{ chain: mine.chain, quantity: 1 }], cash: 0 },
      { stocks: [], cash: 500 }
    )
  })
})
