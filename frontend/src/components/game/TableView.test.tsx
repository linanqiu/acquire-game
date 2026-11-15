/**
 * Net worth, majority/minority holders and the merger result (BL-007), rendered from REAL
 * recorded server messages (tests/unit/fixtures/wire-messages.json). Nothing is added up here:
 * the components show what the server's calculator sent, and the tests check exactly that.
 */
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
          expect(minority).toHaveTextContent('(tie)')
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
    render(<MergerResult merger={merger} players={state.players} onDismiss={() => {}} />)
    const card = screen.getByTestId('merger-result')
    expect(screen.getByTestId('merger-result-title')).toHaveTextContent(
      'Halcyon takes over Aurelia'
    )
    const d = merger.defunct[0]
    expect(card).toHaveTextContent(`${d.size} tiles at ${money(d.price)}`)
    for (const b of d.bonuses!) {
      const row = screen.getByTestId(`merger-bonus-aurelia-${b.player_id}`)
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
    render(<MergerResult merger={merger} players={state.players} onDismiss={() => {}} />)
    expect(screen.getByTestId('merger-result-summary')).toHaveTextContent(
      `to ${merger.survivor_size} tiles`
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

describe('useMergerResult: open, close, reopen', () => {
  beforeEach(() => sessionStorage.clear())
  const host = () => snapshot('disposition-waiting-on-other').host as GameStateMessage
  const done = () => snapshot('three-player-midgame').host as GameStateMessage

  it('a merger in progress when the page loads opens; a finished one does not', () => {
    const live = renderHook(() => useMergerResult(host().mergers, 'k1'))
    expect(live.result.current.shown?.seq).toBe(host().mergers![0].seq)
    const old = renderHook(() => useMergerResult(done().mergers, 'k2'))
    expect(old.result.current.shown).toBeNull()
  })

  it('a merger that appears later opens, stays after updates, closes for good, reopens on demand', () => {
    const merger = host().mergers![0]
    const { result, rerender } = renderHook(
      ({ m }: { m: MergerRecord[] }) => useMergerResult(m, 'k3'),
      { initialProps: { m: [] as MergerRecord[] } }
    )
    expect(result.current.shown).toBeNull()
    rerender({ m: [merger] })
    expect(result.current.shown?.seq).toBe(merger.seq)
    rerender({ m: [{ ...merger, complete: true, survivor_size: 11 }] })
    expect(result.current.shown?.complete).toBe(true)
    act(() => result.current.dismiss())
    expect(result.current.shown).toBeNull()
    rerender({ m: [{ ...merger, complete: true, survivor_size: 11 }] })
    expect(result.current.shown).toBeNull()
    act(() => result.current.open(merger.seq))
    expect(result.current.shown?.seq).toBe(merger.seq)
    // A reload in the same tab does not bring back a card that was closed.
    const again = renderHook(() => useMergerResult([merger], 'k3'))
    expect(again.result.current.shown).toBeNull()
  })

  it('the log reopens a merger', () => {
    const state = done()
    let opened: number | null = null
    render(
      <MergerLog mergers={state.mergers!} players={state.players} onOpen={(s) => (opened = s)} />
    )
    const log = screen.getByTestId('merger-log')
    fireEvent.click(within(log).getByTestId(`merger-log-${state.mergers![0].seq}`))
    expect(opened).toBe(state.mergers![0].seq)
  })
})
