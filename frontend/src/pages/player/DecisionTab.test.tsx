/**
 * The decision tab ("Now", BL-011) on the player page, driven by REAL recorded server states
 * (tests/unit/fixtures/generate_wire_messages.py): each decision shows the information needed
 * to make it, and the numbers are the server's (the fixture's `expect` block comes from the
 * engine). The WebSocket is replaced by a recorder, nothing else is faked.
 */
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from '../PlayerPage'
import { ToastProvider } from '../../components/ui/ToastProvider'
import { useGameStore } from '../../store/gameStore'
import { deliver, loadSnapshotAsPlayer, snapshot } from '../../../tests/unit/fixtures/wire'
import { decisionEvents, decisionView, turnKey } from '../../lib/decision'
import { lobbyPhaseText, waitingPhaseText } from '../../lib/phaseText'
import { changeText, placeOf, placeText } from '../../lib/standing'
import { DEFAULT_RS } from '../../../tests/unit/fixtures/rulesets'

const { sendAction } = vi.hoisted(() => ({ sendAction: vi.fn((_action: unknown) => true) }))
vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ sendAction, reconnect: vi.fn(() => Promise.resolve(true)) }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/play/TEST']}>
      <ToastProvider>
        <Routes>
          <Route path="/play/:room" element={<PlayerPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`
const stateOf = (view: ReturnType<typeof snapshot>) =>
  view.player.find((m) => m.type === 'game_state')!
const decision = () => screen.getByTestId('decision-view')

beforeEach(() => {
  sendAction.mockClear()
  sessionStorage.clear()
  useGameStore.getState().reset()
})

describe('where I stand among holders (share counts only)', () => {
  const holders = [
    { player_id: 'b', shares: 9 },
    { player_id: 'c', shares: 5 },
    { player_id: 'me', shares: 3 },
  ]
  it('names my place, ties and the gap', () => {
    expect(placeText(placeOf(holders, 'me', 3))).toBe('3rd, 2 behind')
    expect(placeText(placeOf(holders, 'me', 5))).toBe('tied 2nd')
    expect(placeText(placeOf(holders, 'me', 10))).toBe('1st')
    expect(placeOf(holders, 'me', 0).place).toBeNull()
  })
  it('says how a purchase or trade would move me', () => {
    expect(changeText(holders, 'me', 3, 0)).toBe('')
    expect(changeText(holders, 'me', 3, 1)).toBe('3rd, 1 behind')
    expect(changeText(holders, 'me', 3, 2)).toBe('would tie 2nd')
    expect(changeText(holders, 'me', 3, 3)).toBe('takes 2nd')
    expect(changeText(holders, 'me', 3, 6)).toBe('would tie 1st')
    expect(changeText(holders, 'me', 3, 7)).toBe('takes 1st')
    expect(changeText([{ player_id: 'me', shares: 4 }], 'me', 4, 1)).toBe('stays 1st')
  })
})

describe('which view and which events, from recorded states', () => {
  const viewOf = (name: Parameters<typeof snapshot>[0]) => {
    const view = snapshot(name)
    const gs = stateOf(view)
    const prompt = (t: string) => view.player.some((m) => m.type === t)
    const last = gs.mergers?.at(-1)
    return {
      view,
      gs,
      kind: decisionView({
        phase: gs.phase,
        isMyTurn: gs.current_player === view.human,
        survivorChoice: prompt('choose_merger_survivor'),
        disposition: prompt('stock_disposition_required'),
        foundChoice: prompt('choose_chain'),
        mergerInProgress: !!last && !last.complete,
        explicitMerger: false,
      }),
    }
  }

  it('my decisions first, then a merger in progress, then waiting', () => {
    expect(viewOf('buy-phase-multi-chain').kind).toBe('buy')
    expect(viewOf('disposition-human-first').kind).toBe('disposition')
    expect(viewOf('disposition-waiting-on-other').kind).toBe('merger')
    expect(viewOf('merger-survivor-tie').kind).toBe('survivor')
    expect(viewOf('found-chain-choice').kind).toBe('found')
    expect(viewOf('opening-place-tile').kind).toBe('place')
    expect(viewOf('trade-incoming-not-my-turn').kind).toBe('waiting')
  })

  it('events: my decision per turn, offers for me, a live merger starting and resolving', () => {
    const { gs } = viewOf('disposition-waiting-on-other')
    const m = gs.mergers.at(-1)
    const key = turnKey(gs.current_player, Object.keys(gs.board.cells).length)
    expect(
      decisionEvents({ turnKey: key, view: 'waiting', mergers: gs.mergers, live: [] })
    ).toEqual([])
    expect(
      decisionEvents({ turnKey: key, view: 'waiting', mergers: gs.mergers, live: [m.seq] })
    ).toEqual([`merger:${m.seq}`])
    const done = [...gs.mergers.slice(0, -1), { ...m, complete: true }]
    expect(decisionEvents({ turnKey: key, view: 'waiting', mergers: done, live: [m.seq] })).toEqual(
      [`merger:${m.seq}`, `merger-done:${m.seq}`]
    )
    expect(
      decisionEvents({
        turnKey: key,
        view: 'buy',
        incomingTradeIds: ['t1'],
        disposition: { seq: 3, chain: 'halcyon' },
      })
    ).toEqual([`buy:${key}`, 'disposition:3:halcyon', 'trade:t1'])
  })

  it('the phase bar names who the table waits on and what they are doing', () => {
    const players = { p2: { name: 'Bob' }, p3: { name: 'Goldie Gains' } }
    const waitingOn = (player_id: string, decision: string) =>
      waitingPhaseText(DEFAULT_RS, { player_id, decision } as never, players, 'Alice')
    expect(waitingOn('p2', 'buy_stocks')).toBe('BOB IS BUYING SHARES')
    expect(waitingOn('p2', 'place_tile')).toBe('BOB IS PLACING A TILE')
    expect(waitingOn('p2', 'found_chain')).toBe('BOB IS FOUNDING A HOTEL CHAIN')
    expect(waitingOn('p2', 'choose_survivor')).toBe('BOB IS CHOOSING THE SURVIVING HOTEL CHAIN')
    expect(waitingOn('p2', 'stock_disposition')).toBe('BOB IS DISPOSING OF SHARES')
    expect(waitingOn('p2', 'trade_response')).toBe('BOB IS ANSWERING A TRADE OFFER')
    // The short name a narrow row prints, when the page has one.
    expect(
      waitingPhaseText(
        DEFAULT_RS,
        { player_id: 'p3', decision: 'buy_stocks' } as never,
        players,
        'Alice',
        () => 'Goldie'
      )
    ).toBe('GOLDIE IS BUYING SHARES')
    // Nothing known about who is awaited, or a decision this page does not know: whose turn.
    expect(waitingPhaseText(DEFAULT_RS, null, players, 'Alice')).toBe("Alice's TURN")
    expect(waitingOn('p2', 'something_new')).toBe("Alice's TURN")
    expect(waitingOn('p9', 'buy_stocks')).toBe("Alice's TURN")
  })

  it('the lobby banner: what the room waits for, for the host and for a guest', () => {
    expect(lobbyPhaseText(false, 1, 3)).toBe('WAITING FOR THE HOST TO START')
    expect(lobbyPhaseText(true, 1, 3)).toBe('NEED 2 MORE PLAYERS TO START')
    expect(lobbyPhaseText(true, 2, 3)).toBe('NEED 1 MORE PLAYER TO START')
    expect(lobbyPhaseText(true, 3, 3)).toBe('START WHEN EVERYONE IS IN')
  })
})

describe('buying: one compact row per chain, the rest one tap away', () => {
  it('shows price, tiles, bank and my shares per chain; holders and bonuses open on a tap; my purchase shows how it moves me', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    const gs = stateOf(view)
    expect(decision()).toHaveAttribute('data-view', 'buy')
    for (const chain of gs.hotel.active_chains) {
      const row = screen.getByTestId(`buy-row-${chain}`)
      const info = gs.chain_holders[chain]
      const mine = gs.players[view.human].stocks[chain] ?? 0
      expect(row).toHaveAttribute('data-mine', String(mine))
      // The row itself: the numbers of the decision, once each, under the shared header.
      expect(within(row).getByTestId('buy-price')).toHaveTextContent(money(info.price))
      expect(within(row).getByTestId('buy-size')).toHaveTextContent(`${info.size} tiles`)
      expect(within(row).getByTestId('buy-available')).toHaveTextContent(
        `${gs.hotel.available_stocks[chain]} left`
      )
      // My shares, marked as in the players table (the engine's role for me in this chain).
      const myHolder = info.holders.find((h) => h.player_id === view.human)
      const role = mine > 0 ? (myHolder?.role ?? null) : null
      const cell = within(row).getByTestId('buy-mine')
      expect(cell).toHaveTextContent(String(mine))
      if (role) {
        expect(cell).toHaveTextContent(
          `${myHolder.tied ? 'tied for ' : ''}${role === 'majority' ? 'most shares' : 'second most shares'}`
        )
      } else {
        expect(cell).not.toHaveTextContent('most shares')
      }
      // Holders and bonuses are not printed in every row: a tap on the chain opens them.
      expect(within(row).queryByTestId('buy-bonus')).toBeNull()
      expect(within(row).queryByTestId(`buy-holders-${chain}`)).toBeNull()
      const toggle = within(row).getByTestId(`buy-details-${chain}`)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(within(row).getByTestId('buy-bonus')).toHaveTextContent(
        `1st ${money(info.majority_bonus)} · 2nd ${money(info.minority_bonus)}`
      )
      // Every holder with their count; me always (with 0 when I hold none).
      for (const h of info.holders) {
        expect(within(row).getByTestId(`buy-holders-${chain}-${h.player_id}`)).toHaveAttribute(
          'data-shares',
          String(h.shares)
        )
      }
      expect(within(row).getByTestId(`buy-holders-${chain}-${view.human}`)).toHaveAttribute(
        'data-shares',
        String(mine)
      )
    }
    // One chain is open at a time: the last one tapped. Close it.
    const last = gs.hotel.active_chains.at(-1)
    fireEvent.click(screen.getByTestId(`buy-details-${last}`))
    expect(screen.queryAllByTestId('buy-bonus')).toHaveLength(0)
    // The header names the columns once.
    expect(screen.getAllByTestId('buy-head')).toHaveLength(1)
    expect(screen.getByTestId('buy-head')).toHaveTextContent('PriceTilesBankYouBuy')
    // Step up a chain with stock left: the row says what my count becomes, how that moves
    // me among the holders, and what 1st and 2nd are paid, without a tap.
    const chain = gs.hotel.active_chains.find(
      (c: string) => gs.hotel.available_stocks[c] > 0 && gs.chain_holders[c].price <= 3000
    )
    const row = screen.getByTestId(`buy-row-${chain}`)
    const mine = gs.players[view.human].stocks[chain] ?? 0
    fireEvent.click(within(row).getByTestId('stepper-increment'))
    expect(within(row).getByTestId('buy-mine')).toHaveTextContent(String(mine))
    expect(within(row).getByTestId('buy-mine-next')).toHaveTextContent(String(mine + 1))
    expect(within(row).getByTestId('buy-bonus')).toHaveTextContent(
      `1st ${money(gs.chain_holders[chain].majority_bonus)}`
    )
    expect(screen.getAllByTestId('buy-bonus')).toHaveLength(1)
    expect(
      within(row).getByRole('spinbutton', { name: new RegExp(`shares to buy$`) })
    ).toHaveAttribute('aria-valuenow', '1')
    expect(within(row).getByTestId('buy-projection')).toHaveTextContent(
      changeText(gs.chain_holders[chain].holders, view.human, mine, 1)
    )
    const cost = gs.chain_holders[chain].price
    expect(screen.getByTestId('purchase-cash-after')).toHaveTextContent(
      money(gs.players[view.human].money - cost)
    )
  })
})

describe('a merger: the whole merger in the decision tab', () => {
  it('my disposition: defunct holders and decisions, the survivor after the merger, live projection', () => {
    const view = loadSnapshotAsPlayer('disposition-human-first')
    renderPage()
    const gs = stateOf(view)
    const m = gs.mergers.at(-1)
    const after = m.survivor_after
    const exp = view.expect.mergers.at(-1).survivor_after
    expect(after.size).toBe(exp.size)
    expect(decision()).toHaveAttribute('data-view', 'disposition')
    // The survivor's size after the merger is said once, in the summary line.
    expect(screen.getByTestId('merger-result-summary')).toHaveTextContent(`→ ${exp.size} tiles`)
    expect(screen.queryByTestId('survivor-after-size')).toBeNull()
    expect(screen.getByTestId('survivor-after-price')).toHaveTextContent(money(exp.price))
    expect(screen.getByTestId('survivor-after-bank')).toHaveTextContent(`bank ${exp.bank}`)
    expect(screen.getByTestId('survivor-after-bonus')).toHaveTextContent(
      `1st ${money(exp.majority_bonus)} · 2nd ${money(exp.minority_bonus)}`
    )
    for (const h of after.holders) {
      const row = screen.getByTestId(`survivor-row-${h.player_id}`)
      expect(row).toHaveAttribute('data-shares', String(h.shares))
      if (h.undecided && h.player_id !== view.human) expect(row).toHaveTextContent('undecided')
    }
    // Defunct chain holders: me deciding, the others to decide, with their counts.
    const d = m.defunct[0]
    for (const p of d.waiting_on) {
      const row = screen.getByTestId(`merger-waiting-${d.chain}-${p}`)
      expect(row).toHaveTextContent(String(gs.players[p].stocks[d.chain]))
    }
    // Trade 2:1 as far as the bank allows: my survivor row, place, bank and cash follow live.
    const me = after.holders.find((h: { player_id: string }) => h.player_id === view.human)
    const trade = screen.getByTestId(/^slider-trade-/)
    const max = Number(trade.getAttribute('max'))
    fireEvent.change(trade, { target: { value: String(max) } })
    const got = max / 2
    expect(screen.getByTestId(`survivor-row-${view.human}`)).toHaveAttribute(
      'data-shares',
      String(me.shares + got)
    )
    expect(screen.getByTestId('survivor-after-bank')).toHaveTextContent(
      `bank ${exp.bank} → ${exp.bank - got}`
    )
    expect(screen.getByTestId('survivor-my-place')).toHaveTextContent(
      changeText(after.holders, view.human, me.shares, got)
    )
    // My row among the stockholders says I am deciding; the numbers of my choice are at the
    // sliders, once.
    expect(screen.getByTestId(`merger-waiting-${d.chain}-${view.human}`)).toHaveTextContent(
      'deciding…'
    )
    expect(screen.getByTestId(`merger-waiting-${d.chain}-${view.human}`)).not.toHaveTextContent(
      'trade'
    )
    expect(screen.getByTestId('disposition-trade')).toHaveTextContent(`${max} shares → ${got} `)
    expect(screen.queryByTestId('disposition-summary')).toBeNull()
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(sendAction.mock.calls.at(-1)?.[0]).toEqual({
      action: 'merger_disposition',
      defunct_chain: d.chain,
      disposition: {
        sell: 0,
        trade: max,
        hold: gs.players[view.human].stocks[d.chain] - max,
      },
    })
  })

  it("someone else's disposition: the same merger, read-only, and who the table waits on", () => {
    const view = loadSnapshotAsPlayer('disposition-waiting-on-other')
    renderPage()
    const gs = stateOf(view)
    expect(decision()).toHaveAttribute('data-view', 'merger')
    // Who the table waits on: the phase bar, once (and "deciding…" in their row below).
    expect(screen.getByTestId('game-phase')).toHaveTextContent(
      `${gs.players[gs.awaiting.player_id].name.toUpperCase()} IS DISPOSING OF SHARES`
    )
    expect(screen.queryByTestId('waiting-message')).toBeNull()
    expect(
      screen.getByTestId(
        `merger-waiting-${gs.mergers.at(-1).defunct[0].chain}-${gs.awaiting.player_id}`
      )
    ).toHaveTextContent('deciding…')
    expect(within(decision()).getByTestId('merger-result')).toBeInTheDocument()
    expect(within(decision()).getByTestId('merger-survivor-after')).toBeInTheDocument()
    expect(screen.queryByTestId('merger-disposition')).not.toBeInTheDocument()
    expect(screen.queryByTestId('merger-result-dismiss')).not.toBeInTheDocument()
  })

  it('survivor choice: each tied chain with size, price, bank stock and holders', () => {
    const view = loadSnapshotAsPlayer('merger-survivor-tie')
    renderPage()
    const gs = stateOf(view)
    const prompt = view.player.find((x) => x.type === 'choose_merger_survivor')!
    for (const chain of prompt.tied_chains) {
      const facts = screen.getByTestId(`choice-facts-${chain}`)
      const info = gs.chain_holders[chain]
      expect(facts).toHaveTextContent(`${info.size} tiles`)
      expect(facts).toHaveTextContent(`${gs.hotel.available_stocks[chain]} left`)
      for (const h of info.holders) {
        expect(
          within(facts).getByTestId(`choice-holders-${chain}-${h.player_id}`)
        ).toBeInTheDocument()
      }
    }
  })

  it('a merger that finishes while I watch stays until the next tile is placed, then goes by itself', () => {
    const view = snapshot('disposition-waiting-on-other')
    deliver(view.player, view.human)
    renderPage()
    const gs = stateOf(view)
    const m = gs.mergers.at(-1)
    // The server reports the merger done (the remaining holders sold): the record completes.
    const done = {
      ...gs,
      phase: 'buy_stocks',
      awaiting: null,
      mergers: [
        ...gs.mergers.slice(0, -1),
        { ...m, complete: true, survivor_size: 11, survivor_after: null },
      ],
    }
    act(() => deliver([done], view.human))
    expect(decision()).toHaveAttribute('data-view', 'waiting')
    expect(within(decision()).getByTestId('merger-result')).toHaveAttribute(
      'data-merger-seq',
      String(m.seq)
    )
    // Nothing to close, and while it is shown in full the quiet line does not repeat it.
    expect(screen.queryByTestId('merger-result-dismiss')).not.toBeInTheDocument()
    expect(within(decision()).queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    expect(within(decision()).queryByTestId(`merger-log-${m.seq}`)).not.toBeInTheDocument()
    // Play moves on: the next tile is placed. The result goes by itself.
    const empty = Object.keys(done.board.cells).find((c) => done.board.cells[c].state === 'empty')
    const coord = empty ?? '12I'
    const next = {
      ...done,
      phase: 'buy_stocks',
      board: { cells: { ...done.board.cells, [coord]: { state: 'played', chain: null } } },
    }
    act(() => deliver([next], view.human))
    expect(within(decision()).queryByTestId('merger-result')).not.toBeInTheDocument()
    // The outcome is still one tap away, in a quiet line that opens in place and closes again.
    const line = within(screen.getByTestId('decision-last-merger')).getByTestId(
      `merger-log-${m.seq}`
    )
    expect(line).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
    expect(within(decision()).getByTestId('merger-result')).toHaveAttribute(
      'data-merger-seq',
      String(m.seq)
    )
    fireEvent.click(line)
    expect(within(decision()).queryByTestId('merger-result')).not.toBeInTheDocument()
  })
})
