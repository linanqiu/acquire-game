/**
 * Net worth, majority/minority holders and the merger result (BL-007), rendered from REAL
 * recorded server messages (tests/unit/fixtures/wire-messages.json). Nothing is added up here:
 * the components show what the server's calculator sent, and the tests check exactly that.
 */
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Standings } from './Standings'
import { ChainTable } from './ChainTable'
import { MergerLog, MergerResult } from './MergerResult'
import { useMergerResult } from '../../hooks/useMergerResult'
import { snapshot } from '../../../tests/unit/fixtures/wire'
import type { GameStateMessage, MergerRecord } from '../../types/api'

const money = (n: number) => `$${n.toLocaleString('en-US')}`

describe('Standings: every player net worth and rank from the server', () => {
  it('shows cash, shares at current prices, net worth and rank for each seat', () => {
    const view = snapshot('three-player-midgame')
    const state = view.player.find((m) => m.type === 'game_state') as GameStateMessage
    render(<Standings gameState={state} myPlayerId={view.human} />)
    for (const [seat, w] of Object.entries<any>(view.expect.net_worth)) {
      const id = view.seats[seat]
      expect(screen.getByTestId(`player-cash-${id}`)).toHaveTextContent(money(w.cash))
      expect(screen.getByTestId(`player-stockvalue-${id}`)).toHaveTextContent(money(w.stock_value))
      expect(screen.getByTestId(`player-networth-${id}`)).toHaveTextContent(money(w.net_worth))
      expect(screen.getByTestId(`player-rank-${id}`)).toHaveTextContent(String(w.rank))
    }
    const mine = screen
      .getAllByTestId('player-row')
      .find((r) => r.getAttribute('data-player-id') === view.human)!
    expect(mine).toHaveTextContent('YOU')
  })

  it('a row is one line of cells: name, one cell per chain, cash, worth with the rank (BL-014)', () => {
    const view = snapshot('three-player-midgame')
    const state = view.player.find((m) => m.type === 'game_state') as GameStateMessage
    render(<Standings gameState={state} myPlayerId={view.human} />)
    const chains = state.ruleset!.chains.length
    for (const row of screen.getAllByTestId('player-row')) {
      const id = row.getAttribute('data-player-id')!
      expect(row.children).toHaveLength(chains + 3)
      // The rank is in the worth cell, in front of the amount; the cash cell holds the cash.
      const worth = row.lastElementChild as HTMLElement
      expect(worth).toContainElement(screen.getByTestId(`player-rank-${id}`))
      expect(worth).toContainElement(screen.getByTestId(`player-networth-${id}`))
      expect(worth.textContent).toMatch(/^=?#\d+ \$/)
      // What the row no longer prints is still said: cash + shares, as the cells' tooltip.
      expect(worth.title).toContain(money(state.players[id].stock_value!))
    }
  })

  it('the footer (tiles, price, bank) is there with chains on the board, and gone with none', () => {
    const mid = snapshot('three-player-midgame')
    const state = mid.player.find((m) => m.type === 'game_state') as GameStateMessage
    const first = render(<Standings gameState={state} />)
    expect(state.hotel.active_chains.length).toBeGreaterThan(0)
    for (const id of ['matrix-size', 'matrix-price', 'matrix-bank'])
      expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(screen.getByTestId('holdings-matrix')).toHaveAttribute('data-footer', 'true')
    first.unmount()

    const opening = snapshot('opening-place-tile')
    const start = opening.player.find((m) => m.type === 'game_state') as GameStateMessage
    expect(start.hotel.active_chains).toEqual([])
    render(<Standings gameState={start} />)
    for (const id of ['matrix-size', 'matrix-price', 'matrix-bank'])
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    expect(screen.getByTestId('holdings-matrix')).toHaveAttribute('data-footer', 'false')
    // Every chain keeps its column all the same.
    expect(screen.getAllByTestId(/^matrix-chain-/)).toHaveLength(start.ruleset!.chains.length)
  })

  it('an AI seat prints its first name; the whole name stays in the row and the tooltip', () => {
    const view = snapshot('three-player-midgame')
    const state = structuredClone(
      view.player.find((m) => m.type === 'game_state') as GameStateMessage
    )
    const other = Object.keys(state.players).find((id) => id !== view.human)!
    state.players[other] = {
      ...state.players[other],
      name: 'Dolly Dollars',
      kind: 'bot',
      is_bot: true,
    }
    render(<Standings gameState={state} myPlayerId={view.human} />)
    const row = screen
      .getAllByTestId('player-row')
      .find((r) => r.getAttribute('data-player-id') === other)!
    const name = within(row).getByTestId('player-name')
    expect(name).toHaveTextContent('Dolly Dollars')
    expect(name).toHaveAttribute('title', 'Dolly Dollars')
    expect(name.firstChild?.textContent).toBe('Dolly')
    // The seat icon is a button in the same line as the name.
    const badge = within(row).getByRole('button', { name: /bot/i })
    expect(badge.parentElement).toBe(name.parentElement)
    fireEvent.click(badge)
    expect(screen.getByRole('dialog', { name: 'About Dolly Dollars' })).toHaveTextContent(
      money(state.players[other].stock_value!)
    )
  })
})

describe('ChainTable: majority and minority at a glance', () => {
  it('names the 1st and 2nd holders with shares and bonus, ties marked, and my position', () => {
    const view = snapshot('disposition-waiting-on-other')
    const state = view.player.find((m) => m.type === 'game_state') as GameStateMessage
    render(<ChainTable gameState={state} myPlayerId={view.human} />)
    const names = Object.fromEntries(
      Object.entries<string>(view.seats).map(([seat, id]) => [seat, state.players[id].name])
    )
    let sawTie = false
    for (const [chain, info] of Object.entries<any>(view.expect.chain_holders)) {
      const first = info.holders.filter((h: any) => h.role === 'majority')
      const second = info.holders.filter((h: any) => h.role === 'minority')
      const majority = screen.getByTestId(`chain-majority-${chain}`)
      for (const h of first) {
        expect(majority).toHaveTextContent(names[h.player_id])
        expect(majority).toHaveTextContent(money(h.bonus))
      }
      if (second.length > 0) {
        const minority = screen.getByTestId(`chain-minority-${chain}`)
        for (const h of second) {
          expect(minority).toHaveTextContent(names[h.player_id])
          expect(minority).toHaveTextContent(money(h.bonus))
        }
        if (second.length > 1) {
          sawTie = true
          expect(minority).toHaveAttribute('data-tied', 'true')
          expect(minority).toHaveTextContent('=2nd')
          expect(minority).toHaveTextContent('each')
        }
      }
      const mine = info.holders.find((h: any) => h.player_id === 'p1')
      if (mine) {
        const you = screen.getByTestId(`chain-you-${chain}`)
        if (mine.role === 'majority') expect(you).toHaveTextContent(/1st/)
        else if (mine.role === 'minority') expect(you).toHaveTextContent(/2nd/)
        else expect(you).toHaveTextContent(/behind/)
        if (mine.tied) expect(you).toHaveTextContent('tied')
      }
    }
    expect(sawTie, 'the fixture has a minority tie').toBe(true)
  })
})

describe('MergerResult: what a merger did', () => {
  it('shows the takeover, the bonuses paid and who still decides', () => {
    const view = snapshot('disposition-waiting-on-other')
    const state = view.host as GameStateMessage
    const merger = state.mergers![0]
    render(<MergerResult merger={merger} players={state.players} />)
    const card = screen.getByTestId('merger-result')
    expect(screen.getByTestId('merger-result-title')).toHaveTextContent(
      'Halcyon takes over Aurelia'
    )
    const d = merger.defunct[0]
    expect(card).toHaveTextContent(`${d.size} tiles · ${money(d.price)}`)
    for (const b of d.bonuses!) {
      // In the holder's row: name, shares, the bonus paid, the decision.
      const row = screen.getByTestId(`merger-bonus-aurelia-${b.player_id}`).closest('tr')!
      expect(row).toHaveTextContent(state.players[b.player_id].name)
      expect(row).toHaveTextContent(money(b.majority + b.minority))
    }
    expect(screen.getAllByText('2nd (tie)')).toHaveLength(2)
    const [first, ...rest] = d.waiting_on
    expect(screen.getByTestId(`merger-waiting-aurelia-${first}`)).toHaveTextContent('deciding')
    for (const p of rest) {
      expect(screen.getByTestId(`merger-waiting-aurelia-${p}`)).toHaveTextContent('to decide')
    }
  })

  it('lists what each stockholder did once the merger is over', () => {
    const view = snapshot('three-player-midgame')
    const state = view.host as GameStateMessage
    const merger = state.mergers!.find((m) => m.complete)!
    render(<MergerResult merger={merger} players={state.players} />)
    expect(screen.getByTestId('merger-result-summary')).toHaveTextContent(
      `→ ${merger.survivor_size} tiles`
    )
    for (const d of merger.defunct) {
      for (const x of d.dispositions) {
        const row = screen.getByTestId(`merger-disposition-${d.chain}-${x.player_id}`)
        if (x.sell) expect(row).toHaveTextContent(`sold ${x.sell}`)
        if (x.trade) expect(row).toHaveTextContent(`traded ${x.trade}`)
        if (x.hold) expect(row).toHaveTextContent(`kept ${x.hold}`)
      }
    }
  })
})

describe('useMergerResult: shown by itself, gone by itself', () => {
  const host = () => snapshot('disposition-waiting-on-other').host as GameStateMessage
  const done = () => snapshot('three-player-midgame').host as GameStateMessage

  it('a merger in progress when the page loads is shown; a finished one is not', () => {
    const live = renderHook(() => useMergerResult(host().mergers, 30))
    expect(live.result.current.auto?.seq).toBe(host().mergers![0].seq)
    const old = renderHook(() => useMergerResult(done().mergers, 30))
    expect(old.result.current.auto).toBeNull()
  })

  it('a merger that appears later is shown, stays when it ends, and goes when the next tile is placed', () => {
    const merger = host().mergers![0]
    const finished = { ...merger, complete: true, survivor_size: 11 }
    const { result, rerender } = renderHook(
      ({ m, tiles }: { m: MergerRecord[]; tiles: number }) => useMergerResult(m, tiles),
      { initialProps: { m: [] as MergerRecord[], tiles: 30 } }
    )
    expect(result.current.auto).toBeNull()
    rerender({ m: [merger], tiles: 31 })
    expect(result.current.auto?.seq).toBe(merger.seq)
    expect(result.current.live).toEqual([merger.seq])
    rerender({ m: [finished], tiles: 31 })
    expect(result.current.auto?.complete).toBe(true)
    // More updates on the same board (the merging player buys): still there.
    rerender({ m: [{ ...finished }], tiles: 31 })
    expect(result.current.auto?.seq).toBe(merger.seq)
    // The next tile: play has moved on.
    rerender({ m: [finished], tiles: 32 })
    expect(result.current.auto).toBeNull()
    // A reload after that does not bring the result back.
    const again = renderHook(() => useMergerResult([finished], 32))
    expect(again.result.current.auto).toBeNull()
  })

  it('the log keeps every merger: a line opens in place to the result and closes again', () => {
    const state = done()
    render(<MergerLog mergers={state.mergers!} players={state.players} gameState={state} />)
    const log = screen.getByTestId('merger-log')
    const line = within(log).getByTestId(`merger-log-${state.mergers![0].seq}`)
    expect(within(log).queryByTestId('merger-result')).not.toBeInTheDocument()
    fireEvent.click(line)
    expect(line).toHaveAttribute('aria-expanded', 'true')
    expect(within(log).getByTestId('merger-result')).toHaveAttribute(
      'data-merger-seq',
      String(state.mergers![0].seq)
    )
    fireEvent.click(line)
    expect(within(log).queryByTestId('merger-result')).not.toBeInTheDocument()
  })
})
