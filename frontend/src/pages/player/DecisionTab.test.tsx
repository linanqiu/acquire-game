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
import { decisionEvents, decisionView, statusText, turnKey } from '../../lib/decision'
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
        orderChoice: prompt('choose_merger_order'),
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
    expect(viewOf('merger-order-tie').kind).toBe('order')
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

  it('the status line names what is needed', () => {
    const opts = { waiting: 'Waiting for Bob to buy shares...' }
    expect(statusText('buy', DEFAULT_RS, opts)).toEqual({
      text: 'Your move: buy shares',
      mine: true,
    })
    expect(statusText('waiting', DEFAULT_RS, opts)).toEqual({
      text: 'Waiting for Bob to buy shares',
      mine: false,
    })
    expect(statusText('waiting', DEFAULT_RS, { ...opts, offerFrom: 'Cara' }).text).toBe(
      'Trade offer from Cara: answer it'
    )
  })
})

describe('buying: every chain with its holders, my shares and the stepper', () => {
  it('shows the engine holders and bonuses per chain, and how my purchase moves me', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    const gs = stateOf(view)
    expect(decision()).toHaveAttribute('data-view', 'buy')
    for (const chain of gs.hotel.active_chains) {
      const row = screen.getByTestId(`buy-row-${chain}`)
      const info = gs.chain_holders[chain]
      const mine = gs.players[view.human].stocks[chain] ?? 0
      expect(row).toHaveAttribute('data-mine', String(mine))
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
    // Step up a chain with stock left: my chip shows the count after and the position change.
    const chain = gs.hotel.active_chains.find(
      (c: string) => gs.hotel.available_stocks[c] > 0 && gs.chain_holders[c].price <= 3000
    )
    const row = screen.getByTestId(`buy-row-${chain}`)
    const mine = gs.players[view.human].stocks[chain] ?? 0
    fireEvent.click(within(row).getByTestId('stepper-increment'))
    expect(within(row).getByTestId(`buy-holders-${chain}-${view.human}`)).toHaveTextContent(
      `${mine}→${mine + 1}`
    )
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
    expect(screen.getByTestId('survivor-after-size')).toHaveTextContent(`${exp.size} tiles`)
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
    expect(screen.getByTestId(`merger-waiting-${d.chain}-${view.human}`)).toHaveTextContent(
      `deciding: sell 0, trade ${max}`
    )
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
    expect(screen.getByTestId('waiting-message')).toHaveTextContent(
      `Waiting for ${gs.players[gs.awaiting.player_id].name}`
    )
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

  it('merger order: one tappable row per same-size chain with size, price, bonuses and holders', () => {
    const view = loadSnapshotAsPlayer('merger-order-tie')
    renderPage()
    const gs = stateOf(view)
    const prompt = view.player.find((x) => x.type === 'choose_merger_order')!
    expect(decision()).toHaveAttribute('data-view', 'order')
    expect(screen.getByTestId('merger-order-title')).toHaveTextContent(
      'Which hotel chain is absorbed first?'
    )
    expect(within(screen.getByTestId('merger-order')).getAllByRole('button')).toHaveLength(
      prompt.tied_chains.length
    )
    for (const chain of prompt.tied_chains) {
      const info = gs.chain_holders[chain]
      const row = screen.getByTestId(`merger-order-${chain}`)
      expect(within(row).getByTestId(`merger-order-facts-${chain}`)).toHaveTextContent(
        `${info.size} tiles · ${money(info.price)}`
      )
      expect(within(row).getByTestId(`merger-order-bonus-${chain}`)).toHaveTextContent(
        `1st ${money(info.majority_bonus)} · 2nd ${money(info.minority_bonus)}`
      )
      for (const h of info.holders) {
        expect(
          within(row).getByTestId(`merger-order-holders-${chain}-${h.player_id}`)
        ).toHaveAttribute('data-shares', String(h.shares))
      }
    }
    // The status line and the event that brings the page to this panel.
    expect(statusText('order', DEFAULT_RS, { waiting: '' })).toEqual({
      text: 'Your move: choose which hotel chain is absorbed first',
      mine: true,
    })
    const key = turnKey(gs.current_player, Object.keys(gs.board.cells).length)
    expect(decisionEvents({ turnKey: key, view: 'order', mergers: gs.mergers })).toEqual([
      `order:${key}:0`,
    ])
    // Tapping a row answers at once and the panel goes.
    const pick = prompt.tied_chains[1]
    fireEvent.click(screen.getByTestId(`merger-order-${pick}`))
    expect(sendAction.mock.calls.at(-1)?.[0]).toEqual({
      action: 'merger_order',
      defunct_chain: pick,
    })
    expect(screen.queryByTestId('merger-order')).not.toBeInTheDocument()
  })

  it('merger order: the second question of a three-way tie asks which is absorbed next', () => {
    const view = loadSnapshotAsPlayer('merger-order-tie')
    const gs = stateOf(view)
    const m = gs.mergers.at(-1)
    // As the server reports it once the first chain was paid.
    const first = { ...m.defunct[0], bonuses: [] }
    act(() => {
      useGameStore.getState().handleMessage({
        ...gs,
        mergers: [...gs.mergers.slice(0, -1), { ...m, defunct: [first, ...m.defunct.slice(1)] }],
      } as never)
    })
    renderPage()
    expect(screen.getByTestId('merger-order-title')).toHaveTextContent(
      'Which hotel chain is absorbed next?'
    )
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
