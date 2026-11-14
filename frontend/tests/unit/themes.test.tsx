/**
 * Every key screen under the shipped non-classic rulesets (valley "Acquihire", mini
 * "Harborline"): names, numbers, wording and board size come from the ruleset, and no classic
 * chain name or "Acquire" leaks into the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LobbyPage } from '../../src/pages/LobbyPage'
import { PlayerPage } from '../../src/pages/PlayerPage'
import { HostPage } from '../../src/pages/HostPage'
import { BenchPage } from '../../src/pages/BenchPage'
import { TranscriptPage } from '../../src/pages/TranscriptPage'
import { ToastProvider } from '../../src/components/ui/ToastProvider'
import { useGameStore } from '../../src/store/gameStore'
import { contrastRatio, readableText, rulesetForTranscript } from '../../src/lib/ruleset'
import { CLASSIC_RULESET } from '../../src/ruleset/classic'
import type { GameStateMessage } from '../../src/types/api'
import type { Ruleset } from '../../src/types/ruleset'
import type { Transcript } from '../../src/types/transcripts'
import {
  ALL_RULESETS,
  CLASSIC,
  MINI,
  VALLEY,
  classicLeaks,
  useServerRuleset,
} from './fixtures/rulesets'

vi.mock('../../src/hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    sendAction: vi.fn(() => true),
    reconnect: vi.fn(() => Promise.resolve(true)),
    disconnect: vi.fn(),
    isConnected: true,
  }),
}))
vi.mock('../../src/hooks/useHostWebSocket', () => ({
  useHostWebSocket: () => ({ reconnect: vi.fn(), disconnect: vi.fn(), isConnected: true }),
}))

const THEMED = [
  ['valley', VALLEY],
  ['mini', MINI],
] as const

function renderAt(path: string, routes: { path: string; element: React.ReactElement }[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  )
}

const renderPlayer = (query = '') =>
  renderAt(`/play/ROOM${query}`, [{ path: '/play/:room', element: <PlayerPage /> }])
const renderHost = () => renderAt('/host/ROOM', [{ path: '/host/:room', element: <HostPage /> }])

function expectNoClassicLeaks() {
  expect(classicLeaks(document.body.textContent ?? '')).toEqual([])
}

/** A plausible in-game state for `rs`: three active chains (one safe), three players. */
function gameStateFor(rs: Ruleset, phase: GameStateMessage['phase']): GameStateMessage {
  const [a, b, c] = rs.chains
  const sizes: Record<string, number> = { [a.id]: 2, [b.id]: 4, [c.id]: rs.safe_chain_size }
  const cells: GameStateMessage['board']['cells'] = {
    '1A': { state: 'in_chain', chain: a.id },
    '2A': { state: 'in_chain', chain: a.id },
    '1C': { state: 'in_chain', chain: b.id },
    '2C': { state: 'in_chain', chain: b.id },
    '4E': { state: 'played', chain: null },
    [`${rs.board.columns}${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[rs.board.rows - 1]}`]: {
      state: 'in_chain',
      chain: c.id,
    },
  }
  const price = (id: string, size: number) => {
    const tier = rs.tiers.find((t) => t.id === rs.chains.find((x) => x.id === id)!.tier)!
    return [...tier.prices].reverse().find((p) => size >= p.from)!.price
  }
  const stocks = (n: number) => Object.fromEntries(rs.chains.map((ch, i) => [ch.id, i < 3 ? n : 0]))
  return {
    type: 'game_state',
    phase,
    board: { cells },
    hotel: {
      chains: rs.chains.map((ch) => ({
        name: ch.id,
        size: sizes[ch.id] ?? 0,
        price: sizes[ch.id] ? price(ch.id, sizes[ch.id]) : 0,
        stocks_available: rs.stocks_per_chain - 4,
        color: ch.color,
      })),
      available_stocks: Object.fromEntries(rs.chains.map((ch) => [ch.id, rs.stocks_per_chain - 4])),
      active_chains: [a.id, b.id, c.id],
    },
    turn_order: ['p1', 'p2', 'p3'],
    current_player: 'p1',
    players: {
      p1: {
        name: 'Alice',
        money: rs.starting_cash * 10,
        stocks: stocks(2),
        hand_size: rs.hand_size,
      },
      p2: {
        name: 'Botty',
        money: rs.starting_cash,
        stocks: stocks(1),
        hand_size: rs.hand_size,
        is_bot: true,
        kind: 'bot',
      },
      p3: { name: 'Cara', money: rs.starting_cash, stocks: stocks(0), hand_size: rs.hand_size },
    },
    tiles_remaining: rs.board.columns * rs.board.rows - 20,
    your_hand: ['3B', '4B', '5B', '6B', '3D'].slice(0, rs.hand_size),
    ruleset: rs,
  }
}

beforeEach(() => {
  useGameStore.getState().reset()
  sessionStorage.setItem('player_id', 'p1')
  sessionStorage.setItem('player_name', 'Alice')
  sessionStorage.setItem('session_token', 'tok')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe.each(THEMED)('%s ruleset', (_name, rs) => {
  const upperTitle = rs.title.toUpperCase()

  it('home page: title, tagline, players, board and chain count', () => {
    useServerRuleset(rs)
    renderAt('/', [{ path: '/', element: <LobbyPage /> }])
    expect(screen.getByRole('heading', { name: upperTitle })).toBeInTheDocument()
    expect(screen.getByTestId('home-tagline')).toHaveTextContent(rs.theme.tagline)
    const meta = screen.getByTestId('home-meta')
    expect(meta).toHaveTextContent(`${rs.min_players}-${rs.max_players} players`)
    expect(meta).toHaveTextContent(`${rs.board.columns}×${rs.board.rows} board`)
    expect(meta).toHaveTextContent(`${rs.chains.length} ${rs.theme.chain_noun_plural}`)
    expect(screen.getByTestId('bench-link')).toHaveTextContent(`${rs.title} Bench`)
    expectNoClassicLeaks()
  })

  it('room lobby: seat limits from the ruleset', () => {
    useServerRuleset(rs)
    useGameStore.setState({
      connectionStatus: 'connected',
      lobbyPlayers: [{ player_id: 'p1', name: 'Alice', is_bot: false }],
    })
    renderPlayer('?is_host=1')
    expect(screen.getByText(`1/${rs.max_players} players`)).toBeInTheDocument()
    const need = rs.min_players - 1
    expect(screen.getByTestId('start-hint')).toHaveTextContent(`Need ${need} more player`)
    expect(screen.getByTestId('header-title')).toHaveTextContent(upperTitle)
    expectNoClassicLeaks()
  })

  it('board: columns x rows from the ruleset, chain squares named and coloured', () => {
    useServerRuleset(rs)
    useGameStore.setState({
      connectionStatus: 'connected',
      gameState: gameStateFor(rs, 'place_tile'),
    })
    useGameStore.setState({ yourHand: gameStateFor(rs, 'place_tile').your_hand ?? [] })
    renderPlayer()
    const board = screen.getByTestId('board')
    expect(within(board).getAllByTestId(/^tile-/)).toHaveLength(rs.board.columns * rs.board.rows)
    expect(board).toHaveAttribute('data-columns', String(rs.board.columns))
    expect(board).toHaveAttribute('data-rows', String(rs.board.rows))
    const a = rs.chains[0]
    const sq = within(board).getByTestId('tile-1A')
    expect(sq).toHaveTextContent(a.abbreviation)
    expect(sq.style.getPropertyValue('--chain-bg')).toBe(a.color)
    expect(screen.getByTestId('game-phase')).toHaveTextContent('PLACE A TILE')
    // players panel: holdings as abbreviation + count on the chain colour
    const badge = screen.getByTestId(`player-stock-p1-${a.id}`)
    expect(badge).toHaveTextContent(/^2$/)
    expect(badge).toHaveAttribute('data-abbr', a.abbreviation)
    expect(badge.style.getPropertyValue('--chain-bg')).toBe(a.color)
    expectNoClassicLeaks()
  })

  it('buy screen: names, prices in the currency, per-turn limit from the ruleset', () => {
    useServerRuleset(rs)
    useGameStore.setState({
      connectionStatus: 'connected',
      gameState: gameStateFor(rs, 'buy_stocks'),
    })
    renderPlayer()
    const t = rs.theme
    expect(screen.getByTestId('game-phase')).toHaveTextContent(`BUY ${t.stock_label.toUpperCase()}`)
    expect(screen.getByTestId('purchase-shares')).toHaveTextContent(
      `(0/${rs.max_stock_purchases_per_turn} ${t.share_noun_plural})`
    )
    const a = rs.chains[0]
    const row = screen.getByTestId(`buy-row-${a.id.toLowerCase()}`)
    expect(row).toHaveTextContent(a.name)
    expect(within(row).getByTestId('buy-price')).toHaveTextContent(t.currency_symbol)
    // Buy as many of one chain as allowed: the stepper stops at the ruleset's per-turn limit.
    const plus = within(row).getByTestId('stepper-increment')
    for (let i = 0; i < 10; i++) if (!plus.hasAttribute('disabled')) fireEvent.click(plus)
    expect(within(row).getByTestId('stepper-value')).toHaveTextContent(
      String(rs.max_stock_purchases_per_turn)
    )
    expect(plus).toBeDisabled()
    // The board stays on the page during the buy phase (folded only on phones, by CSS).
    expect(screen.getByTestId('board')).toBeInTheDocument()
    expect(screen.getByTestId('board-toggle')).toHaveTextContent('SHOW BOARD')
    expectNoClassicLeaks()
  })

  it('disposition: chain names, share noun, merger noun and trade ratio from the ruleset', () => {
    useServerRuleset(rs)
    const [defunct, survivor] = rs.chains
    useGameStore.setState({
      connectionStatus: 'connected',
      gameState: gameStateFor(rs, 'stock_disposition'),
      pendingStockDisposition: {
        defunctChain: defunct.id,
        survivingChain: survivor.id,
        stockCount: 6,
        availableToTrade: 5,
      },
    })
    renderPlayer()
    const t = rs.theme
    expect(screen.getByTestId('game-phase')).toHaveTextContent(
      `DISPOSE YOUR ${t.share_noun_plural.toUpperCase()}`
    )
    expect(
      screen.getByText(
        `DISPOSE OF YOUR ${defunct.name.toUpperCase()} ${t.share_noun_plural.toUpperCase()}`
      )
    ).toBeInTheDocument()
    const form = screen.getByTestId('merger-disposition')
    expect(form).toHaveTextContent(`Price at ${t.merger_noun}`)
    const r = rs.merger_trade_ratio
    expect(
      within(form).getByText(`TRADE ${r}:1 for ${survivor.name.toUpperCase()}`)
    ).toBeInTheDocument()
    expectNoClassicLeaks()
  })

  it('portfolio: holdings with names and amounts in the currency', () => {
    useServerRuleset(rs)
    useGameStore.setState({
      connectionStatus: 'connected',
      gameState: gameStateFor(rs, 'place_tile'),
    })
    renderPlayer()
    const table = screen.getByTestId('portfolio-table')
    for (const ch of rs.chains.slice(0, 3)) {
      expect(within(table).getByTestId(`portfolio-row-${ch.id.toLowerCase()}`)).toHaveTextContent(
        ch.name
      )
    }
    expectNoClassicLeaks()
  })

  it('game over: standings in the currency, wording from the ruleset', () => {
    useServerRuleset(rs)
    useGameStore.setState({
      connectionStatus: 'connected',
      gameState: gameStateFor(rs, 'game_over'),
      gameOver: {
        type: 'game_over',
        winner: 'p1',
        scores: {
          p1: { name: 'Alice', money: 30000, bonuses: 2000, stock_sales: 3000 },
          p2: { name: 'Botty', money: 20000, bonuses: 0, stock_sales: 1000 },
          p3: { name: 'Cara', money: 10000, bonuses: 0, stock_sales: 0 },
        },
      },
    })
    renderPlayer()
    // Final money is the state's (10x starting cash for Alice in this fixture)
    expect(screen.getByTestId('winner-announcement')).toHaveTextContent(
      `${rs.theme.currency_symbol}${(rs.starting_cash * 10).toLocaleString('en-US')}`
    )
    expect(screen.getByTestId('breakdown')).toHaveTextContent(`${rs.theme.stock_label} sold`)
    expectNoClassicLeaks()
  })

  it('host page: title, seat limits in the lobby; chains panel and board in the game', () => {
    useServerRuleset(rs)
    useGameStore.setState({ connectionStatus: 'connected', lobbyPlayers: [] })
    const { unmount } = renderHost()
    expect(screen.getByTestId('host-title')).toHaveTextContent(upperTitle)
    expect(screen.getByText(`PLAYERS (0/${rs.max_players})`)).toBeInTheDocument()
    expectNoClassicLeaks()
    unmount()

    useGameStore.setState({ gameState: gameStateFor(rs, 'buy_stocks') })
    renderHost()
    expect(screen.getByTestId('header-title')).toHaveTextContent(upperTitle)
    expect(screen.getByText(rs.theme.chain_noun_plural.toUpperCase())).toBeInTheDocument()
    const list = screen.getByTestId('chain-list')
    const safeChain = rs.chains[2]
    expect(
      within(list).getByTestId(`chain-marker-${safeChain.id.toLowerCase()}`)
    ).toHaveTextContent(rs.theme.safe_phrase)
    expect(within(screen.getByTestId('board')).getAllByTestId(/^tile-/)).toHaveLength(
      rs.board.columns * rs.board.rows
    )
    expect(screen.getByTestId('game-phase')).toHaveTextContent(
      `BUY ${rs.theme.stock_label.toUpperCase()}`
    )
    expectNoClassicLeaks()
  })

  it('bench page: "<title> Bench" in the heading and the document title', () => {
    useServerRuleset(rs)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    )
    renderAt('/bench', [{ path: '/bench', element: <BenchPage /> }])
    expect(screen.getByTestId('bench-title')).toHaveTextContent(`${upperTitle} BENCH`)
    expect(document.title).toBe(`${rs.title} Bench`)
    expectNoClassicLeaks()
  })
})

// -- Transcript viewer --------------------------------------------------------------

const FULL = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'transcript-full.json'), 'utf8')
) as Transcript

/** The classic fixture with every chain id swapped for a valley one (same numbers, same tiers). */
function asValley(t: Transcript, withHeader: boolean): Transcript {
  const map: Record<string, string> = {}
  CLASSIC.chains.forEach((c, i) => (map[c.id] = VALLEY.chains[i].id))
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return map[v] ?? v
    if (Array.isArray(v)) return v.map(swap)
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [map[k] ?? k, swap(x)]))
    return v
  }
  const out = swap(t) as Transcript
  out.header = { ...out.header, ruleset: withHeader ? VALLEY : undefined }
  return out
}

function renderViewer(t: Transcript) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => t,
    }))
  )
  return renderAt(`/games/${t.header.game_id}?step=999`, [
    { path: '/games/:gameId', element: <TranscriptPage /> },
  ])
}

describe('transcript viewer under the transcript ruleset', () => {
  it("uses the header's ruleset even when the server runs another one", async () => {
    useServerRuleset(MINI)
    renderViewer(asValley(FULL, true))
    const viewer = await screen.findByTestId('transcript-viewer')
    expect(viewer).toHaveAttribute('data-board', '12x9')
    const board = screen.getByTestId('board')
    expect(within(board).getAllByTestId(/^tile-/)).toHaveLength(108)
    const names = VALLEY.chains.map((c) => c.name)
    const table = screen.getByTestId('chain-table')
    expect(names.some((n) => table.textContent?.includes(n))).toBe(true)
    // Chrome keeps the server's product name
    expect(screen.getAllByText(/Harborline Bench/).length).toBeGreaterThan(0)
    expectNoClassicLeaks()
  })

  it('falls back to chains and board seen in the states when the header has no ruleset', () => {
    const t = asValley(FULL, false)
    const states = t.entries.flatMap((e) =>
      e.type === 'state'
        ? [(e as { public: Parameters<typeof rulesetForTranscript>[1][number] }).public]
        : []
    )
    // On a server running that ruleset: the server's
    expect(rulesetForTranscript(undefined, states, [VALLEY])).toBe(VALLEY)
    // Elsewhere: rebuilt from the states (ids as names, never the classic title)
    const rs = rulesetForTranscript(undefined, states, [MINI])
    expect(rs.chains.map((c) => c.id).every((id) => VALLEY.chains.some((v) => v.id === id))).toBe(
      true
    )
    expect(rs.title).toBe('')
    // A classic transcript without a header ruleset is classic
    const classicStates = FULL.entries.flatMap((e) =>
      e.type === 'state'
        ? [(e as { public: Parameters<typeof rulesetForTranscript>[1][number] }).public]
        : []
    )
    expect(rulesetForTranscript(undefined, classicStates, [VALLEY])).toBe(CLASSIC_RULESET)
  })
})

// -- Contrast ------------------------------------------------------------------------

describe('chain colours are readable', () => {
  for (const [name, rs] of Object.entries(ALL_RULESETS)) {
    it(`${name}: every chain gets a foreground with at least 4.5:1 contrast`, () => {
      for (const c of rs.chains) {
        const fg = readableText(c.color)
        expect(contrastRatio(c.color, fg), `${c.name} ${c.color} on ${fg}`).toBeGreaterThanOrEqual(
          4.5
        )
      }
    })
  }

  it('picks dark text on light colours and light text on dark ones', () => {
    expect(readableText('#FFD700')).toBe('#111111')
    expect(readableText('#0000FF')).toBe('#FFFFFF')
  })
})

describe('the built-in classic fallback', () => {
  it('is identical to backend/rulesets/classic.json', () => {
    expect(CLASSIC_RULESET).toEqual(CLASSIC)
  })
})
