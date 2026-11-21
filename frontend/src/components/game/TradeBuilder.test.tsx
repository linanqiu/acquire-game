import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TradeBuilder } from './TradeBuilder'
import { snapshot, playerState } from '../../../tests/unit/fixtures/wire'
import { DEFAULT_RULESET } from '../../ruleset/defaultRuleset'

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
  const prices = Object.fromEntries(state.hotel.chains.map((c) => [c.name, c.price]))
  return { players, myHoldings, myCash: me.money, prices, myPlayerId: view.human }
}

/** The player the tests trade with: someone with cash and shares. */
const partnerOf = (props) => props.players.find((p) => p.cash >= 5000)
const scene = () => {
  const props = propsFrom()
  return { ...props, partner: partnerOf(props) }
}

function mount(extra = {}) {
  const props = propsFrom()
  const onPropose = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <TradeBuilder {...props} onPropose={onPropose} onCancel={onCancel} {...extra} />
  )
  return { ...props, onPropose, onCancel, partner: partnerOf(props), view }
}

const pick = (p) => fireEvent.click(screen.getByTestId(`player-select-${p.id}`))
const add = (side, chain, n = 1) => {
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByTestId(`${side}-add-${chain}`))
}
const row = (side, chain) => within(screen.getByTestId(`${side}-stock-${chain}`))
const send = () => screen.getByTestId('propose-trade')
const type = (id, value) => fireEvent.change(screen.getByTestId(id), { target: { value } })
const held = (stocks) => Object.entries(stocks).filter(([, q]) => q > 0)
const order = DEFAULT_RULESET.chains.map((c) => c.id)

/** The server's preview route, answered with `preview`; returns the calls made. */
function previewAnswers(preview) {
  const calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) })
      return { ok: true, json: async () => (typeof preview === 'function' ? preview() : preview) }
    })
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('TradeBuilder', () => {
  it('lists the other players with their cash; until one is chosen it says so and cannot be sent', () => {
    const { players, onPropose } = mount()
    for (const p of players) {
      const button = screen.getByTestId(`player-select-${p.id}`)
      expect(button).toHaveTextContent(p.name)
      expect(button).toHaveTextContent(`$${p.cash.toLocaleString('en-US')}`)
      expect(button).toHaveAttribute('aria-pressed', 'false')
      // An AI seat's kind icon is its own element here (the players table has the seat's badge).
      if (p.kind && p.kind !== 'human') {
        expect(within(button).getByTestId(`trade-player-kind-${p.id}`)).toBeInTheDocument()
        expect(screen.queryByTestId(`seat-kind-${p.id}`)).not.toBeInTheDocument()
      }
    }
    expect(players.some((p) => p.kind && p.kind !== 'human')).toBe(true)
    expect(screen.getByTestId('trade-hint')).toHaveTextContent('Choose who to offer to')
    expect(within(screen.getByTestId('trade-get')).getByText('Choose a player')).toBeInTheDocument()
    expect(send()).toBeDisabled()
    expect(send()).toHaveTextContent('SEND OFFER')
    fireEvent.click(send())
    expect(onPropose).not.toHaveBeenCalled()
  })

  it('says what is missing next to the button: a player, then something to give or get', () => {
    const { partner, onPropose } = mount()
    pick(partner)
    expect(screen.getByTestId('trade-hint')).toHaveTextContent('Add what you give or what you get')
    expect(send()).toBeDisabled()
    expect(send()).toHaveTextContent(`SEND TO ${partner.name.toUpperCase()}`)
    type('offer-cash-input', '100')
    expect(screen.queryByTestId('trade-hint')).not.toBeInTheDocument()
    expect(send()).toBeEnabled()
    expect(onPropose).not.toHaveBeenCalled()
  })

  it('each side lists only the chains it holds, in the ruleset order, with how many', () => {
    const { myHoldings, partner } = mount()
    pick(partner)
    const chips = (side) =>
      screen
        .getAllByTestId(new RegExp(`^${side}-add-`))
        .map((el) => el.getAttribute('data-testid').slice(`${side}-add-`.length))
    const mine = myHoldings.map((h) => h.chain)
    expect(chips('offer')).toEqual(order.filter((c) => mine.includes(c)))
    const theirs = held(partner.stocks).map(([c]) => c)
    expect(chips('want')).toEqual(order.filter((c) => theirs.includes(c)))
    for (const h of myHoldings)
      expect(screen.getByTestId(`offer-add-${h.chain}`)).toHaveTextContent(String(h.quantity))
    // Nothing is in the deal yet: no stepper lines.
    expect(screen.queryAllByTestId(/-stock-/)).toHaveLength(0)
  })

  it('a tap on a chip adds one share; the line with its stepper stops at what the holder has', () => {
    const { myHoldings, partner } = mount()
    pick(partner)
    const mine = myHoldings.find((h) => h.quantity >= 2)
    add('offer', mine.chain)
    expect(row('offer', mine.chain).getByTestId('stepper-value')).toHaveTextContent('1')
    add('offer', mine.chain, mine.quantity + 3)
    expect(row('offer', mine.chain).getByTestId('stepper-value')).toHaveTextContent(
      String(mine.quantity)
    )
    expect(row('offer', mine.chain).getByTestId('stepper-increment')).toBeDisabled()
    expect(screen.getByTestId(`offer-add-${mine.chain}`)).toBeDisabled()
    const [chain, theirs] = held(partner.stocks)[0]
    add('want', chain)
    for (let i = 0; i < theirs + 3; i++) {
      const more = row('want', chain).getByTestId('stepper-increment')
      if (!more.disabled) fireEvent.click(more)
    }
    expect(row('want', chain).getByTestId('stepper-value')).toHaveTextContent(String(theirs))
    // Back to none: the line goes, the chip stays where it was.
    for (let i = 0; i < theirs; i++)
      fireEvent.click(row('want', chain).getByTestId('stepper-decrement'))
    expect(screen.queryByTestId(`want-stock-${chain}`)).not.toBeInTheDocument()
    expect(screen.getByTestId(`want-add-${chain}`)).toBeEnabled()
  })

  it('cash: typed digits only, in steps of 100 with the buttons, never more than that side has', () => {
    const { myCash, partner } = mount()
    pick(partner)
    for (const typed of ['-', 'abc', '']) {
      type('offer-cash-input', typed)
      expect(screen.getByTestId('offer-cash-input')).toHaveValue('')
      expect(send()).toBeDisabled()
    }
    fireEvent.click(screen.getByTestId('offer-cash-more'))
    fireEvent.click(screen.getByTestId('offer-cash-more'))
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('200')
    fireEvent.click(screen.getByTestId('offer-cash-less'))
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('100')
    type('offer-cash-input', String(myCash + 999))
    expect(screen.getByTestId('offer-cash-input')).toHaveValue(String(myCash))
    expect(screen.getByTestId('offer-cash-more')).toBeDisabled()
    type('want-cash-input', String(partner.cash + 999))
    expect(screen.getByTestId('want-cash-input')).toHaveValue(String(partner.cash))
  })

  it('a proposal carries the partner, the stocks and the cash of both sides', () => {
    const { myHoldings, partner, onPropose } = mount()
    pick(partner)
    const mine = myHoldings.find((h) => h.quantity >= 2)
    add('offer', mine.chain, 2)
    const [chain] = held(partner.stocks)[0]
    add('want', chain)
    type('offer-cash-input', '300')
    type('want-cash-input', '100')
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [{ chain: mine.chain, quantity: 2 }], cash: 300 },
      { stocks: [{ chain, quantity: 1 }], cash: 100 }
    )
  })

  it('both sides are valued at list prices next to their headings', () => {
    const { myHoldings, partner, prices } = mount()
    pick(partner)
    const mine = myHoldings.find((h) => h.quantity >= 2 && prices[h.chain] > 0)
    expect(screen.getByTestId('trade-give-value')).toHaveTextContent('')
    add('offer', mine.chain, 2)
    type('want-cash-input', '700')
    expect(screen.getByTestId('trade-give-value')).toHaveTextContent(
      `$${(2 * prices[mine.chain]).toLocaleString('en-US')}`
    )
    expect(screen.getByTestId('trade-get-value')).toHaveTextContent('$700')
  })

  it('cash for cash is a valid trade', () => {
    const { partner, onPropose } = mount()
    pick(partner)
    type('offer-cash-input', '500')
    type('want-cash-input', '400')
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [], cash: 500 },
      { stocks: [], cash: 400 }
    )
  })

  it('choosing another player clears what I had asked the first one for, not what I give', () => {
    const { players, partner, myHoldings } = mount()
    pick(partner)
    const [chain] = held(partner.stocks)[0]
    add('want', chain)
    type('want-cash-input', '200')
    add('offer', myHoldings[0].chain)
    pick(players.find((p) => p !== partner))
    expect(screen.queryAllByTestId(/^want-stock-/)).toHaveLength(0)
    expect(screen.getByTestId('want-cash-input')).toHaveValue('')
    expect(row('offer', myHoldings[0].chain).getByTestId('stepper-value')).toHaveTextContent('1')
  })

  it('a player with no shares is said to have none; so am I', () => {
    const view = propsFrom('trade-incoming')
    const poor = view.players.find((p) => Object.values(p.stocks).every((q) => q === 0))
    render(<TradeBuilder {...view} onPropose={() => {}} onCancel={() => {}} />)
    expect(within(screen.getByTestId('trade-give')).getByText('No shares')).toBeInTheDocument()
    pick(poor)
    expect(within(screen.getByTestId('trade-get')).getByText('No shares')).toBeInTheDocument()
  })

  it("shows the server's refusal and the notice, and cannot be sent while a proposal is in flight", () => {
    mount({
      serverError: 'Cannot trade Sandpiper stock during its merger',
      notice: 'A merger is on',
      submitting: true,
    })
    expect(screen.getByTestId('trade-error')).toHaveTextContent(
      'Cannot trade Sandpiper stock during its merger'
    )
    expect(screen.getByText('A merger is on')).toBeInTheDocument()
    expect(send()).toBeDisabled()
  })

  it('CANCEL puts the offer away', () => {
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
        title="Competing offer"
        startedFrom="Started from Cara's offer to Bob."
        initial={{
          partnerId: partner.id,
          offer: { stocks: [{ chain: mine.chain, quantity: 1 }], cash: 0 },
          want: { stocks: [], cash: 600 },
        }}
      />
    )
    expect(screen.getByTestId('trade-builder')).toHaveAccessibleName('Competing offer')
    expect(screen.getByTestId('trade-started-from')).toHaveTextContent(
      "Started from Cara's offer to Bob."
    )
    expect(screen.getByTestId(`player-select-${partner.id}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(row('offer', mine.chain).getByTestId('stepper-value')).toHaveTextContent('1')
    expect(screen.getByTestId('want-cash-input')).toHaveValue('600')
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('')
    // It is only a start: change the price, then send.
    type('want-cash-input', '500')
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [{ chain: mine.chain, quantity: 1 }], cash: 0 },
      { stocks: [], cash: 500 }
    )
  })

  it('the game moving on does not touch the draft; a count is cut only to what its holder still has', () => {
    const { view, players, partner, myHoldings, onPropose, ...rest } = mount()
    pick(partner)
    const [chain, theirs] = held(partner.stocks).find(([, q]) => q >= 2)
    add('want', chain, theirs)
    type('offer-cash-input', '700')
    const mine = myHoldings[0]
    add('offer', mine.chain)
    // A new game state: everyone's cash moved, and the partner now holds one share fewer.
    const moved = players.map((p) => ({
      ...p,
      cash: p.cash + 100,
      stocks: p === partner ? { ...p.stocks, [chain]: theirs - 1 } : p.stocks,
    }))
    view.rerender(
      <TradeBuilder
        {...rest}
        players={moved}
        myHoldings={myHoldings}
        onPropose={onPropose}
        onCancel={vi.fn()}
        version={{}}
      />
    )
    expect(screen.getByTestId(`player-select-${partner.id}`)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('700')
    expect(row('offer', mine.chain).getByTestId('stepper-value')).toHaveTextContent('1')
    expect(row('want', chain).getByTestId('stepper-value')).toHaveTextContent(String(theirs - 1))
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [{ chain: mine.chain, quantity: 1 }], cash: 700 },
      { stocks: [{ chain, quantity: theirs - 1 }], cash: 0 }
    )
  })
})

describe('what the offer would do, next to the button (the server preview)', () => {
  it('asks the server about the draft as it is, and says the changes of place in words', async () => {
    const { partner, myPlayerId } = scene()
    const [chain] = held(partner.stocks)[0]
    const calls = previewAnswers({
      valid: true,
      error: '',
      list: { offering: 0, requesting: 800 },
      positions: [
        {
          chain,
          player_id: partner.id,
          before: 'majority_sole',
          after: 'minority_sole',
          shares_before: 9,
          shares_after: 8,
        },
        {
          chain,
          player_id: myPlayerId,
          before: 'minority_sole',
          after: 'majority_sole',
          shares_before: 6,
          shares_after: 7,
        },
      ],
      bot: null,
    })
    mount({ room: 'ABCD' })
    expect(calls).toHaveLength(0) // nothing to ask yet
    pick(partner)
    add('want', chain)
    const line = await screen.findByTestId(`trade-effect-${chain}`)
    expect(line).toHaveTextContent(`You take 1st · ${partner.name} drops to 2nd`)
    expect(calls.at(-1)).toEqual({
      url: `/api/room/ABCD/trade-preview/${myPlayerId}`,
      body: {
        to_player_id: partner.id,
        offering_stocks: {},
        offering_money: 0,
        requesting_stocks: { [chain]: 1 },
        requesting_money: 0,
      },
    })
    // A human or an LLM seat on the other side: no verdict, the effects only.
    expect(screen.queryByTestId('trade-bot-verdict')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trade-bot-match')).not.toBeInTheDocument()
    expect(send()).toBeEnabled()
  })

  it('shares that move without changing a place say so', async () => {
    const { partner } = scene()
    previewAnswers({ valid: true, error: '', positions: [], bot: null })
    mount({ room: 'ABCD' })
    pick(partner)
    add('want', held(partner.stocks)[0][0])
    expect(await screen.findByTestId('trade-effect-none')).toHaveTextContent(
      'No change of 1st or 2nd place'
    )
  })

  it('a rules bot on the other side: what it would answer, and one tap adds the cash it needs', async () => {
    const { partner } = scene()
    const [chain] = held(partner.stocks)[0]
    let answer = { acceptable: false, cash_needed: 500 }
    previewAnswers(() => ({
      valid: true,
      error: '',
      positions: [],
      bot: { player_id: partner.id, ...answer },
    }))
    const { onPropose } = mount({ room: 'ABCD' })
    pick(partner)
    add('want', chain)
    type('want-cash-input', '200')
    const verdict = await screen.findByTestId('trade-bot-verdict')
    await waitFor(() =>
      expect(verdict).toHaveTextContent(`${partner.name} (bot) would refuse: about $500 short`)
    )
    expect(verdict).toHaveAttribute('data-acceptable', 'false')
    expect(send()).toBeEnabled() // I may still send it
    // The cash it needs: first what I asked of it, then cash of mine.
    answer = { acceptable: true, cash_needed: 0 }
    fireEvent.click(screen.getByTestId('trade-bot-match'))
    expect(screen.getByTestId('want-cash-input')).toHaveValue('')
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('300')
    await waitFor(() =>
      expect(screen.getByTestId('trade-bot-verdict')).toHaveTextContent(
        `${partner.name} (bot) would accept`
      )
    )
    // Nothing more to add: the button keeps its place, switched off.
    expect(screen.getByTestId('trade-bot-match')).toBeDisabled()
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalledWith(
      partner.id,
      { stocks: [], cash: 300 },
      { stocks: [{ chain, quantity: 1 }], cash: 0 }
    )
  })

  it('a bot that no cash of mine would move says so, with nothing to tap', async () => {
    const { partner } = scene()
    previewAnswers({
      valid: true,
      error: '',
      positions: [],
      bot: { player_id: partner.id, acceptable: false, cash_needed: null },
    })
    mount({ room: 'ABCD' })
    pick(partner)
    add('want', held(partner.stocks)[0][0])
    expect(await screen.findByTestId('trade-bot-verdict')).toHaveTextContent(
      `${partner.name} (bot) would refuse, even for all your cash`
    )
    expect(screen.getByTestId('trade-bot-match')).toBeDisabled()
  })

  it('an offer the server would refuse says why in place and cannot be sent', async () => {
    const { partner } = scene()
    previewAnswers({ valid: false, error: 'Maximum of 5 pending trades per player' })
    const { onPropose } = mount({ room: 'ABCD' })
    pick(partner)
    type('offer-cash-input', '100')
    expect(await screen.findByTestId('trade-error')).toHaveTextContent(
      'Maximum of 5 pending trades per player'
    )
    expect(send()).toBeDisabled()
    fireEvent.click(send())
    expect(onPropose).not.toHaveBeenCalled()
  })

  it('EVEN AT LIST sets the cash that makes both sides worth the same, on the side that owes it', () => {
    const { partner, myHoldings, prices } = mount()
    pick(partner)
    const mine = myHoldings.find((h) => prices[h.chain] > 0)
    expect(screen.getByTestId('trade-even')).toBeDisabled() // nothing to balance yet
    add('offer', mine.chain)
    type('offer-cash-input', '100')
    const even = screen.getByTestId('trade-even')
    expect(even).toBeEnabled()
    expect(even).toHaveTextContent(
      `EVEN AT LIST: ${partner.name.toUpperCase()} PAYS $${prices[mine.chain].toLocaleString('en-US')}`
    )
    fireEvent.click(even)
    expect(screen.getByTestId('want-cash-input')).toHaveValue(String(prices[mine.chain]))
    expect(screen.getByTestId('offer-cash-input')).toHaveValue('')
    // Already even: the button keeps its place, switched off.
    expect(screen.getByTestId('trade-even')).toBeDisabled()
    expect(screen.getByTestId('trade-even')).toHaveTextContent(/^EVEN AT LIST$/)
  })

  it('with no answer from the server the composer still works (no effects, the offer can be sent)', async () => {
    const { partner } = scene()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )
    const { onPropose } = mount({ room: 'ABCD' })
    pick(partner)
    type('offer-cash-input', '100')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('trade-error')).not.toBeInTheDocument()
    fireEvent.click(send())
    expect(onPropose).toHaveBeenCalled()
  })
})
