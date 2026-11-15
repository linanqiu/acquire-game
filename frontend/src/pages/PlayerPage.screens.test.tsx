/**
 * The player page, driven by REAL server states (recorded from the backend, see
 * tests/unit/fixtures/generate_wire_messages.py): given what the server sent, which screen
 * is up, what limits the controls enforce, and which action a click sends.
 * The WebSocket is replaced by a recorder, nothing else is faked.
 */
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PlayerPage } from './PlayerPage'
import { ToastProvider } from '../components/ui/ToastProvider'
import { useGameStore } from '../store/gameStore'
import {
  SNAPSHOT_NAMES,
  loadSnapshotAsPlayer,
  playedGame,
  deliver,
} from '../../tests/unit/fixtures/wire'

/** The rack note line that explains `tile` (notes are grouped by reason). */
const rackNote = (tile: string) =>
  document.querySelector(`[data-testid="rack-note"][data-tiles~="${tile}"]`)

const { sendAction, socket } = vi.hoisted(() => ({
  sendAction: vi.fn((_action: unknown) => true),
  // The options the page gave the socket hook (its onError is how a server refusal arrives).
  socket: { onError: undefined as undefined | ((message: string) => void) },
}))
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: (opts: { onError?: (message: string) => void }) => ({
    ...((socket.onError = opts.onError), {}),
    sendAction,
    reconnect: vi.fn(() => Promise.resolve(true)),
  }),
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

const lastAction = () => sendAction.mock.calls.at(-1)?.[0]
const stateOf = (view) => view.player.find((m) => m.type === 'game_state')
const rackTile = (coord) => within(screen.getByTestId('tile-rack')).getByTestId(`tile-${coord}`)

beforeEach(() => {
  sendAction.mockClear()
  useGameStore.getState().reset()
})

/** The panel the player is looking at, by the real phase and who the server waits on. */
const PANELS = [
  'placement-actions',
  'chain-selector',
  'merger-disposition',
  'end-turn-button',
  'waiting-message',
  'game-over',
]
const visiblePanels = () => PANELS.filter((id) => screen.queryByTestId(id) !== null)

describe('which screen each real game state shows', () => {
  // [panel, phase banner]
  const expected: Record<string, [string, string | RegExp]> = {
    'opening-place-tile': ['placement-actions', 'PLACE A TILE'],
    'dead-tile-in-hand': ['placement-actions', 'PLACE A TILE'],
    'safe-chain-on-board': ['placement-actions', 'PLACE A TILE'],
    'three-player-midgame': ['placement-actions', 'PLACE A TILE'],
    'six-player-midgame': ['placement-actions', 'PLACE A TILE'],
    'end-game-available': ['placement-actions', 'PLACE A TILE'],
    'found-chain-choice': ['chain-selector', 'CHOOSE A HOTEL CHAIN'],
    'merger-survivor-tie': ['chain-selector', 'CHOOSE THE SURVIVING HOTEL CHAIN'],
    'disposition-human-first': ['merger-disposition', 'DISPOSE YOUR SHARES'],
    // Not my turn, but I am the one the table waits on.
    'disposition-trade-limited': ['merger-disposition', 'DISPOSE YOUR SHARES'],
    'multi-chain-merger': ['merger-disposition', 'DISPOSE YOUR SHARES'],
    'disposition-waiting-on-other': ['waiting-message', /TURN$/],
    'trade-incoming-not-my-turn': ['waiting-message', /TURN$/],
    'buy-phase-multi-chain': ['end-turn-button', 'BUY STOCKS'],
    'low-cash': ['end-turn-button', 'BUY STOCKS'],
    'last-turn-before-game-over': ['end-turn-button', 'BUY STOCKS'],
    'trade-incoming': ['end-turn-button', 'BUY STOCKS'],
    'trade-outgoing-pending': ['end-turn-button', 'BUY STOCKS'],
    'game-over': ['game-over', 'GAME OVER'],
    'game-over-tie': ['game-over', 'GAME OVER'],
  }

  it('has a row for every recorded state', () => {
    expect(Object.keys(expected).sort()).toEqual([...SNAPSHOT_NAMES].sort())
  })

  it.each(Object.entries(expected))(
    '%s shows only its own panel and banner',
    (name, [panel, banner]) => {
      loadSnapshotAsPlayer(name)
      renderPage()
      expect(visiblePanels()).toEqual([panel])
      expect(screen.getByTestId('game-phase')).toHaveTextContent(banner)
    }
  )

  it('the header and the players panel show the money the server reports, in every recorded state', () => {
    for (const name of SNAPSHOT_NAMES.filter((n) => !n.startsWith('game-over'))) {
      useGameStore.getState().reset()
      const view = loadSnapshotAsPlayer(name)
      const mounted = renderPage()
      const players = stateOf(view).players
      expect(screen.getByTestId('header-cash'), name).toHaveTextContent(
        `$${players[view.human].money.toLocaleString('en-US')}`
      )
      for (const [id, p] of Object.entries(players)) {
        expect(screen.getByTestId(`player-cash-${id}`), name).toHaveTextContent(
          `$${p.money.toLocaleString('en-US')}`
        )
      }
      mounted.unmount()
    }
  })
})

describe('placing a tile', () => {
  it('lists the real hand; the picked tile is named, and PLACE TILE sends it and clears the pick', () => {
    const view = loadSnapshotAsPlayer('opening-place-tile')
    renderPage()
    for (const coord of view.expect.human.hand) expect(rackTile(coord)).toBeInTheDocument()
    expect(screen.queryByTestId('place-tile-button')).not.toBeInTheDocument()
    const pick = view.expect.human.hand[0]
    fireEvent.click(rackTile(pick))
    expect(screen.getByText(pick, { selector: 'strong' })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('place-tile-button'))
    expect(lastAction()).toEqual({ action: 'place_tile', tile: pick })
    expect(screen.queryByText(pick, { selector: 'strong' })).not.toBeInTheDocument()
  })

  it('a tile the engine calls dead cannot be picked, and the rack says why', () => {
    const view = loadSnapshotAsPlayer('dead-tile-in-hand')
    renderPage()
    const [dead] = Object.keys(view.expect.human.unplayable_tiles)
    expect(rackNote(dead)).toHaveTextContent(/8th hotel chain/)
    fireEvent.click(rackTile(dead))
    expect(screen.queryByTestId('place-tile-button')).not.toBeInTheDocument()
    // A playable one still works.
    const ok = view.expect.human.hand.find(
      (t: string) => !(t in view.expect.human.unplayable_tiles)
    )
    fireEvent.click(rackTile(ok))
    expect(screen.getByTestId('place-tile-button')).toBeInTheDocument()
  })

  it('END GAME is offered only when the server says the game may be ended, and sends it', () => {
    loadSnapshotAsPlayer('opening-place-tile')
    const { unmount } = renderPage()
    expect(screen.queryByTestId('end-game-button')).not.toBeInTheDocument()
    unmount()
    useGameStore.getState().reset()
    loadSnapshotAsPlayer('end-game-available')
    renderPage()
    fireEvent.click(screen.getByTestId('end-game-button'))
    expect(lastAction()).toEqual({ action: 'declare_end_game' })
  })

  it('when it is not my turn the rack is locked and the page names who is playing', () => {
    const view = loadSnapshotAsPlayer('disposition-waiting-on-other')
    renderPage()
    const awaited = stateOf(view).players[stateOf(view).awaiting.player_id].name
    expect(screen.getByTestId('waiting-message')).toHaveTextContent(
      new RegExp(`Waiting for ${awaited}`)
    )
    expect(screen.queryByTestId('place-tile-button')).not.toBeInTheDocument()
  })
})

describe('founding a chain and choosing a survivor', () => {
  it('only the chains the server offers can be picked; picking one sends found_chain', () => {
    const view = loadSnapshotAsPlayer('found-chain-choice')
    renderPage()
    const offered = view.player.find((m) => m.type === 'choose_chain').available_chains
    const enabled = within(screen.getByTestId('chain-selector'))
      .getAllByRole('radio')
      .filter((b) => !b.disabled)
    expect(enabled).toHaveLength(offered.length)
    fireEvent.click(screen.getByTestId(`chain-button-${offered[0].toLowerCase()}`))
    expect(lastAction()).toEqual({ action: 'found_chain', chain: offered[0] })
    // The prompt is gone as soon as the answer is sent (the server sends no "resolved").
    expect(screen.queryByTestId('chain-selector')).not.toBeInTheDocument()
  })

  it('a tie lets me choose among the tied chains only; the choice is sent as merger_choice', () => {
    const view = loadSnapshotAsPlayer('merger-survivor-tie')
    renderPage()
    const tied = view.player.find((m) => m.type === 'choose_merger_survivor').tied_chains
    const enabled = within(screen.getByTestId('chain-selector'))
      .getAllByRole('radio')
      .filter((b) => !b.disabled)
    expect(enabled).toHaveLength(tied.length)
    fireEvent.click(screen.getByTestId(`chain-button-${tied[1].toLowerCase()}`))
    expect(lastAction()).toEqual({ action: 'merger_choice', surviving_chain: tied[1] })
  })

  const firstOffered = () =>
    within(screen.getByTestId('chain-selector'))
      .getAllByRole('radio')
      .find((b) => !b.disabled)

  it('if the server refuses the answer the prompt comes back so the player can try again', () => {
    loadSnapshotAsPlayer('found-chain-choice')
    renderPage()
    fireEvent.click(firstOffered())
    expect(screen.queryByTestId('chain-selector')).not.toBeInTheDocument()
    act(() => socket.onError('Invalid chain'))
    expect(screen.getByTestId('chain-selector')).toBeInTheDocument()
  })

  it('if the socket is down the answer is not sent and the prompt stays', () => {
    loadSnapshotAsPlayer('found-chain-choice')
    sendAction.mockReturnValueOnce(false)
    renderPage()
    fireEvent.click(firstOffered())
    expect(screen.getByTestId('chain-selector')).toBeInTheDocument()
  })
})

describe('disposing of defunct stock', () => {
  it('starts as "hold everything" and confirming sends exactly that', () => {
    const view = loadSnapshotAsPlayer('disposition-human-first')
    renderPage()
    const prompt = view.player.find((m) => m.type === 'stock_disposition_required')
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(lastAction()).toEqual({
      action: 'merger_disposition',
      defunct_chain: prompt.defunct_chain,
      disposition: { sell: 0, trade: 0, hold: prompt.stock_count },
    })
  })

  it('selling at the price the server shows pays what the page says', () => {
    const view = loadSnapshotAsPlayer('disposition-human-first')
    renderPage()
    const prompt = view.player.find((m) => m.type === 'stock_disposition_required')
    const price = view.expect.active_chains[prompt.defunct_chain].price
    fireEvent.change(screen.getByTestId('slider-sell-to-bank'), { target: { value: '3' } })
    expect(screen.getByTestId('disposition-summary')).toHaveTextContent(
      `SELL 3 (+$${(3 * price).toLocaleString('en-US')})`
    )
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(lastAction().disposition).toEqual({ sell: 3, trade: 0, hold: prompt.stock_count - 3 })
  })

  it('trading is capped by what the bank can still hand out (the engine max_trade)', () => {
    const view = loadSnapshotAsPlayer('disposition-trade-limited')
    renderPage()
    const { max_trade } = view.expect.decisions[0].legal
    const slider = screen.getByTestId(/^slider-trade-/)
    expect(slider).toHaveAttribute('max', String(max_trade))
    expect(slider).not.toBeDisabled()
  })

  it('once the answer is sent the form is gone, and it returns if the server refuses it', () => {
    loadSnapshotAsPlayer('disposition-human-first')
    renderPage()
    fireEvent.click(screen.getByTestId('confirm-disposition'))
    expect(screen.queryByTestId('merger-disposition')).not.toBeInTheDocument()
    act(() => socket.onError('Invalid disposition'))
    expect(screen.getByTestId('merger-disposition')).toBeInTheDocument()
  })
})

describe('buying shares', () => {
  const buyState = (ruleset) => {
    const state = playedGame(ruleset).states['buy_stocks/with_chains']
    deliver([state], state.awaiting.player_id)
    return state
  }
  const row = (chain) => screen.getByTestId(`buy-row-${chain.toLowerCase()}`)

  it.each([
    ['default', 3],
    ['valley', 3],
    ['mini', 4],
  ])(
    '%s: with cash and shares to spare the steppers stop after the ruleset limit of %i',
    (name, limit) => {
      const state = buyState(name)
      expect(state.ruleset.max_stock_purchases_per_turn).toBe(limit)
      renderPage()
      let bought = 0
      for (const c of state.hotel.active_chains) {
        const inc = within(row(c)).getByTestId('stepper-increment')
        while (!inc.disabled) {
          fireEvent.click(inc)
          bought++
        }
      }
      expect(bought).toBe(limit)
      expect(screen.getByTestId('purchase-shares')).toHaveTextContent(`(${limit}/${limit}`)
      // Every chain is now locked, including the one with plenty of shares in the bank.
      for (const c of state.hotel.active_chains) {
        expect(within(row(c)).getByTestId('stepper-increment')).toBeDisabled()
      }
    }
  )

  it('a chain the bank has sold out cannot be bought; cash caps what is affordable', () => {
    loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    expect(within(row('halcyon')).getByTestId('buy-available')).toHaveTextContent('[0]')
    expect(within(row('halcyon')).getByTestId('stepper-increment')).toBeDisabled()
    expect(within(row('obsidian')).getByTestId('stepper-increment')).not.toBeDisabled()
  })

  it('with no cash for any chain the page says so, and skipping sends end_turn', () => {
    loadSnapshotAsPlayer('low-cash')
    renderPage()
    expect(screen.getByTestId('buy-note-no-cash')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('end-turn-button'))
    expect(lastAction()).toEqual({ action: 'end_turn' })
  })

  it('buying sends the purchases, priced as the server prices the chain', () => {
    const view = loadSnapshotAsPlayer('buy-phase-multi-chain')
    renderPage()
    const price = view.expect.active_chains.obsidian.price
    fireEvent.click(within(row('obsidian')).getByTestId('stepper-increment'))
    fireEvent.click(within(row('obsidian')).getByTestId('stepper-increment'))
    expect(screen.getByTestId('purchase-total')).toHaveTextContent(
      `$${(2 * price).toLocaleString('en-US')}`
    )
    fireEvent.click(screen.getByTestId('end-turn-button'))
    expect(lastAction()).toEqual({ action: 'buy_stocks', purchases: { obsidian: 2 } })
  })
})

describe('trades', () => {
  it.each([
    ['accept', 'accept_trade'],
    ['reject', 'reject_trade'],
  ])('an incoming offer can be answered with %s from the page', (button, action) => {
    const view = loadSnapshotAsPlayer('trade-incoming')
    renderPage()
    const [offer] = stateOf(view).incoming_trades
    const offers = screen.getByTestId('trade-offers')
    fireEvent.click(within(offers).getByTestId(`trade-${button}-${offer.trade_id}`))
    expect(lastAction()).toEqual({ action, trade_id: offer.trade_id })
  })

  it('my own pending offer can be cancelled', () => {
    const view = loadSnapshotAsPlayer('trade-outgoing-pending')
    renderPage()
    const [offer] = stateOf(view).outgoing_trades
    fireEvent.click(screen.getByTestId(`trade-cancel-${offer.trade_id}`))
    expect(lastAction()).toEqual({ action: 'cancel_trade', trade_id: offer.trade_id })
  })
})

describe('game over', () => {
  it('lists the standings from the final scores, best first, and names the winner', () => {
    const view = loadSnapshotAsPlayer('game-over')
    renderPage()
    const state = stateOf(view)
    const over = view.player.find((m) => m.type === 'game_over')
    const order = Object.entries(over.scores)
      .sort((a, b) => b[1].money - a[1].money)
      .map(([id]) => id)
    const rows = screen.getAllByTestId(/^rank-/).map((r) => r.getAttribute('data-testid'))
    expect(rows).toEqual(order.map((id) => `rank-${id}`))
    expect(screen.getByTestId('winner-announcement')).toHaveTextContent(
      state.players[over.winner].name
    )
  })

  it('a tie names every winner', () => {
    const view = loadSnapshotAsPlayer('game-over-tie')
    renderPage()
    const state = stateOf(view)
    const over = view.player.find((m) => m.type === 'game_over')
    expect(over.winners.length).toBeGreaterThan(1)
    for (const id of over.winners) {
      expect(screen.getByTestId('winner-announcement')).toHaveTextContent(state.players[id].name)
    }
  })
})
