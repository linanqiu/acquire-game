/**
 * The Trades tab's offers panel with every open offer at the table (offers are public), from
 * real server messages (tests/unit/fixtures/generate_wire_messages.py).
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
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
    onPropose: vi.fn(),
    onCompete: vi.fn(),
    onAnswer: vi.fn(),
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

describe('open offers at the table (Trades tab)', () => {
  it('shows an offer between two other players: who offers whom, what, and for what', () => {
    mount()
    const card = screen.getByTestId(`trade-table-${offer.trade_id}`)
    expect(card).toHaveTextContent(players[o.from].name)
    expect(card).toHaveTextContent(players[o.to].name)
    expect(within(card).getByTestId('trade-stock-aurelia')).toHaveTextContent('×2')
    expect(card).toHaveTextContent('$800')
    // The one card is the count; the tab does not say "1" or "none" over it (BL-017).
    expect(within(screen.getByTestId('trade-table')).getAllByTestId(/^trade-table-/)).toHaveLength(
      1
    )
    expect(screen.queryByTestId('trade-table-empty')).toBeNull()
    expect(screen.getByTestId('trade-offers')).toHaveTextContent('Offers are public')
  })

  it('it is read-only for me: no accept, reject or cancel', () => {
    const h = mount()
    const card = screen.getByTestId(`trade-table-${offer.trade_id}`)
    expect(within(card).queryByText('ACCEPT')).toBeNull()
    expect(within(card).queryByText('REJECT')).toBeNull()
    expect(within(card).queryByText('CANCEL OFFER')).toBeNull()
    expect(screen.queryByTestId(`trade-accept-${offer.trade_id}`)).toBeNull()
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

  it('my own offer is not repeated there; an offer for me points to where I answer it', () => {
    // My own pending offer: in "my offers" with its cancel button, not in the table list.
    const out = playerState('trade-outgoing-pending')
    const me = snapshot('trade-outgoing-pending').human
    const { unmount } = render(
      <TradeOffers
        part="mine"
        offers={out.outgoing_trades}
        tableOffers={out.pending_trades}
        myPlayerId={me}
        players={out.players}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onCancel={vi.fn()}
        onPropose={vi.fn()}
      />
    )
    const [mine] = out.outgoing_trades
    expect(screen.getByTestId(`trade-outgoing-${mine.trade_id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`trade-table-${mine.trade_id}`)).toBeNull()
    // With an offer of mine open, the panel does not also say that none are open.
    expect(screen.queryByTestId('trade-table-empty')).toBeNull()
    expect(screen.queryByTestId('trade-table')).toBeNull()
    unmount()

    const inc = playerState('trade-incoming')
    const onAnswer = vi.fn()
    render(
      <TradeOffers
        part="mine"
        offers={inc.incoming_trades}
        tableOffers={inc.pending_trades}
        myPlayerId={snapshot('trade-incoming').human}
        players={inc.players}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onCancel={vi.fn()}
        onPropose={vi.fn()}
        onAnswer={onAnswer}
      />
    )
    const [forMe] = inc.incoming_trades
    const card = screen.getByTestId(`trade-table-${forMe.trade_id}`)
    expect(card).toHaveTextContent(/offers\s*you/)
    expect(within(card).queryByText(/competing/i)).toBeNull()
    fireEvent.click(screen.getByTestId(`trade-answer-${forMe.trade_id}`))
    expect(onAnswer).toHaveBeenCalled()
  })

  it('the incoming part (decision tab) never lists offers between other players', () => {
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
        onPropose={vi.fn()}
      />
    )
    expect(screen.queryByTestId('trade-incoming')).toBeNull()
    expect(screen.queryByTestId('trade-table')).toBeNull()
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
