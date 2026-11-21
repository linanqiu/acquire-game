/**
 * The offers of the Trades tab and of the table panel (offers are public), from real server
 * messages (tests/unit/fixtures/generate_wire_messages.py).
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TradeOffers } from './TradeOffers'
import { TradeActivity } from './TradeActivity'
import { playerState, snapshot, wireTrades } from '../../../tests/unit/fixtures/wire'
import type { TradeEvent } from '../../store/gameStore'

const o = wireTrades().others
const [offer] = o.state.pending_trades
const players = o.state.players

function mount(extra: Record<string, unknown> = {}) {
  const handlers = {
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onCancel: vi.fn(),
    onCompete: vi.fn(),
    onCounter: vi.fn(),
  }
  render(
    <TradeOffers
      part="mine"
      offers={[]}
      tableOffers={o.state.pending_trades}
      myPlayerId={o.human}
      players={players}
      {...handlers}
      {...extra}
    />
  )
  return handlers
}

afterEach(() => vi.unstubAllGlobals())

describe('open offers at the table (Trades tab)', () => {
  it('shows an offer between two other players: who offers whom, and what each side gives', () => {
    mount()
    const card = screen.getByTestId(`trade-table-${offer.trade_id}`)
    expect(card).toHaveTextContent(players[o.from].name)
    expect(card).toHaveTextContent(players[o.to].name)
    expect(card).toHaveTextContent(`${players[o.from].name} gives`)
    expect(card).toHaveTextContent(`${players[o.to].name} gives`)
    expect(within(card).getByTestId('trade-stock-aurelia')).toHaveTextContent('×2')
    expect(card).toHaveTextContent('$800')
    // The one card is the count; the tab does not say "1" or "none" over it (BL-017).
    expect(screen.getAllByTestId(/^trade-table-trade/)).toHaveLength(1)
    expect(screen.queryByTestId('trade-table-empty')).toBeNull()
  })

  it('it is read-only for me: no accept, reject, counter or withdraw', () => {
    const h = mount()
    const card = screen.getByTestId(`trade-table-${offer.trade_id}`)
    expect(within(card).queryByText('ACCEPT')).toBeNull()
    expect(within(card).queryByText('REJECT')).toBeNull()
    expect(within(card).queryByText('COUNTER')).toBeNull()
    expect(within(card).queryByText('WITHDRAW')).toBeNull()
    expect(screen.queryByTestId(`trade-table-accept-${offer.trade_id}`)).toBeNull()
    expect(screen.queryByTestId(`trade-cancel-${offer.trade_id}`)).toBeNull()
    expect(h.onAccept).not.toHaveBeenCalled()
  })

  it('I can start my own offer to either side from it', () => {
    const h = mount()
    const toRecipient = screen.getByTestId(`trade-compete-recipient-${offer.trade_id}`)
    const toProposer = screen.getByTestId(`trade-compete-proposer-${offer.trade_id}`)
    expect(toRecipient).toHaveTextContent(`TO ${players[o.to].name}`)
    expect(toProposer).toHaveTextContent(`TO ${players[o.from].name}`)
    fireEvent.click(toRecipient)
    expect(h.onCompete).toHaveBeenLastCalledWith(offer, 'recipient')
    fireEvent.click(toProposer)
    expect(h.onCompete).toHaveBeenLastCalledWith(offer, 'proposer')
  })

  it('with nothing open, one quiet line', () => {
    mount({ tableOffers: [] })
    expect(screen.getByTestId('trade-table-empty')).toHaveTextContent('No open offers')
  })

  it('my own offer: both sides, that it waits, and WITHDRAW', () => {
    const out = playerState('trade-outgoing-pending')
    const me = snapshot('trade-outgoing-pending').human
    const h = mount({
      offers: out.outgoing_trades,
      tableOffers: out.pending_trades,
      myPlayerId: me,
      players: out.players,
    })
    const [mine] = out.outgoing_trades
    const card = screen.getByTestId(`trade-outgoing-${mine.trade_id}`)
    expect(card).toHaveTextContent('Your offer to')
    expect(card).toHaveTextContent('waiting')
    expect(card).toHaveTextContent('You give')
    expect(card).toHaveTextContent('You get')
    // It is listed once: not again among the offers of others.
    expect(screen.queryByTestId(`trade-table-${mine.trade_id}`)).toBeNull()
    expect(screen.queryByTestId('trade-table-empty')).toBeNull()
    fireEvent.click(screen.getByTestId(`trade-cancel-${mine.trade_id}`))
    expect(h.onCancel).toHaveBeenCalledWith(mine.trade_id)
  })

  it('an offer for me is answered right there: REJECT, COUNTER, ACCEPT', () => {
    const inc = playerState('trade-incoming')
    const [forMe] = inc.incoming_trades
    const h = mount({
      offers: inc.incoming_trades,
      tableOffers: inc.pending_trades,
      myPlayerId: snapshot('trade-incoming').human,
      players: inc.players,
    })
    const card = screen.getByTestId(`trade-table-${forMe.trade_id}`)
    expect(card).toHaveTextContent(/offers you a trade/)
    expect(within(card).getByTestId('trade-stock-aurelia')).toHaveTextContent('×2')
    expect(card).toHaveTextContent('$800')
    expect(within(card).queryByText(/compete/i)).toBeNull()
    fireEvent.click(screen.getByTestId(`trade-table-counter-${forMe.trade_id}`))
    expect(h.onCounter).toHaveBeenCalledWith(forMe)
    fireEvent.click(screen.getByTestId(`trade-table-accept-${forMe.trade_id}`))
    expect(h.onAccept).toHaveBeenCalledWith(forMe.trade_id)
    // Answered: the buttons are off until the server's answer takes the offer away.
    expect(screen.getByTestId(`trade-table-reject-${forMe.trade_id}`)).toBeDisabled()
    expect(h.onReject).not.toHaveBeenCalled()
  })

  it('when the tab opens, what waits for my answer comes first, then mine, then the others; a new offer goes to the foot of the list', () => {
    const inc = playerState('trade-incoming')
    const me = snapshot('trade-incoming').human
    const [forMe] = inc.incoming_trades
    const other = Object.keys(inc.players).find((id) => id !== me && id !== forMe.from_player_id)!
    const mine = { ...forMe, trade_id: 'mine-1', from_player_id: me, to_player_id: other }
    const theirs = { ...forMe, trade_id: 'theirs-1', to_player_id: other }
    const props = {
      part: 'mine' as const,
      myPlayerId: me,
      players: inc.players,
      onAccept: vi.fn(),
      onReject: vi.fn(),
      onCancel: vi.fn(),
    }
    const ids = () =>
      within(screen.getByTestId('trade-offers'))
        .getAllByTestId(/^trade-(table|outgoing)-[a-z]+-\d+$/)
        .map((el) => el.getAttribute('data-testid'))
    // Made in this order: theirs, mine, for me.
    const view = render(
      <TradeOffers {...props} offers={[mine, forMe]} tableOffers={[theirs, mine, forMe]} />
    )
    expect(ids()).toEqual(['trade-table-trade-1', 'trade-outgoing-mine-1', 'trade-table-theirs-1'])
    // While I look at the list, a second offer for me arrives: under the others, which stay
    // where they are.
    const second = { ...forMe, trade_id: 'second-2' }
    view.rerender(
      <TradeOffers
        {...props}
        offers={[mine, forMe, second]}
        tableOffers={[theirs, mine, forMe, second]}
      />
    )
    expect(ids()).toEqual([
      'trade-table-trade-1',
      'trade-outgoing-mine-1',
      'trade-table-theirs-1',
      'trade-table-second-2',
    ])
    // One is answered: the rest keep their order.
    view.rerender(
      <TradeOffers {...props} offers={[forMe, second]} tableOffers={[theirs, forMe, second]} />
    )
    expect(ids()).toEqual(['trade-table-trade-1', 'trade-table-theirs-1', 'trade-table-second-2'])
    // The tab is left and opened again (my own action): what is for me is first again.
    view.rerender(
      <TradeOffers
        {...props}
        shown={false}
        offers={[forMe, second]}
        tableOffers={[theirs, forMe, second]}
      />
    )
    view.rerender(
      <TradeOffers
        {...props}
        shown
        offers={[forMe, second]}
        tableOffers={[theirs, forMe, second]}
      />
    )
    expect(ids()).toEqual(['trade-table-trade-1', 'trade-table-second-2', 'trade-table-theirs-1'])
  })
})

describe('an offer for me in the table panel (my decision)', () => {
  const inc = playerState('trade-incoming')
  const me = snapshot('trade-incoming').human
  const [forMe] = inc.incoming_trades

  function incoming(extra: Record<string, unknown> = {}) {
    const handlers = { onAccept: vi.fn(), onReject: vi.fn(), onCancel: vi.fn(), onCounter: vi.fn() }
    render(
      <TradeOffers
        part="incoming"
        offers={inc.incoming_trades}
        myPlayerId={me}
        players={inc.players}
        {...handlers}
        {...extra}
      />
    )
    return handlers
  }

  it('says who offers, what I give and get, and has the three answers', () => {
    const h = incoming()
    const card = screen.getByTestId(`trade-offer-${forMe.trade_id}`)
    expect(card).toHaveTextContent(`${inc.players[forMe.from_player_id].name}offers you a trade`)
    expect(card).toHaveTextContent('You give$800')
    expect(within(card).getByTestId('trade-stock-aurelia')).toHaveTextContent('×2')
    fireEvent.click(screen.getByTestId(`trade-counter-${forMe.trade_id}`))
    expect(h.onCounter).toHaveBeenCalledWith(forMe)
    fireEvent.click(screen.getByTestId(`trade-reject-${forMe.trade_id}`))
    expect(h.onReject).toHaveBeenCalledWith(forMe.trade_id)
    expect(screen.getByTestId(`trade-accept-${forMe.trade_id}`)).toBeDisabled()
  })

  it('says what the offer does to first and second place (the server preview of that offer)', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        calls.push({ url: String(url), body: JSON.parse(init.body) })
        return {
          ok: true,
          json: async () => ({
            valid: true,
            error: '',
            positions: [
              {
                chain: 'aurelia',
                player_id: me,
                before: 'none',
                after: 'minority_tied',
                shares_before: 0,
                shares_after: 2,
              },
              {
                chain: 'aurelia',
                player_id: forMe.from_player_id,
                before: 'majority_sole',
                after: 'minority_tied',
                shares_before: 4,
                shares_after: 2,
              },
            ],
            bot: null,
          }),
        }
      })
    )
    incoming({ room: 'ABCD' })
    const effects = await screen.findByTestId(`trade-effects-offer-${forMe.trade_id}`)
    expect(effects).toHaveTextContent(
      `You tie for 2nd · ${inc.players[forMe.from_player_id].name} drops to a tie for 2nd`
    )
    expect(calls[0]).toEqual({
      url: `/api/room/ABCD/trade-preview/${me}`,
      body: { trade_id: forMe.trade_id },
    })
  })

  it('never lists offers between other players, and is nothing at all with no offer for me', () => {
    render(
      <TradeOffers
        part="incoming"
        offers={[]}
        tableOffers={o.state.pending_trades}
        myPlayerId={o.human}
        players={players}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.queryByTestId('trade-incoming')).toBeNull()
    expect(screen.queryByTestId(`trade-table-${offer.trade_id}`)).toBeNull()
  })
})

describe('recent trade activity', () => {
  const event = (seq: number, kind: TradeEvent['kind'], m: Record<string, any>): TradeEvent => ({
    seq,
    kind,
    tradeId: m.trade_id,
    trade: m.trade,
    byPlayerId: m.rejected_by ?? m.canceled_by,
    fromPlayerId: m.from_player,
    toPlayerId: m.to_player,
    reason: m.reason,
    live: true,
  })

  it('says every offer and answer in words with the terms, newest first', () => {
    render(
      <TradeActivity
        players={players}
        events={[
          event(1, 'proposed', o.proposed),
          event(2, 'canceled', o.canceled),
          event(3, 'rejected', o.rejected),
          event(4, 'accepted', o.accepted),
        ]}
      />
    )
    const lines = within(screen.getByTestId('trade-activity'))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(lines).toEqual([
      "Bob accepted Cara's offer: 2 Aurelia for $800.",
      "Bob rejected Cara's offer: 2 Aurelia for $800.",
      'Cara withdrew the offer to Bob: 2 Aurelia for $800.',
      'Cara offers Bob 2 Aurelia for $800.',
    ])
  })

  it('shows the newest few only, and nothing at all when there was no trade', () => {
    const many = Array.from({ length: 9 }, (_, i) => event(i + 1, 'proposed', o.proposed))
    const { unmount } = render(<TradeActivity players={players} events={many} limit={3} />)
    expect(within(screen.getByTestId('trade-activity')).getAllByRole('listitem')).toHaveLength(3)
    unmount()
    render(<TradeActivity players={players} events={[]} />)
    expect(screen.queryByTestId('trade-activity')).toBeNull()
  })

  it('an answer whose terms are unknown still names what is known', () => {
    render(
      <TradeActivity
        players={players}
        events={[
          { ...event(1, 'rejected', o.rejected), trade: undefined, fromPlayerId: undefined },
        ]}
      />
    )
    expect(screen.getByTestId('trade-activity')).toHaveTextContent('Bob rejected a trade offer.')
  })
})
