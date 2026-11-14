/**
 * The sentences of the transcript viewer, on the real events of a finished game
 * (tests/unit/fixtures/transcript-full.json, written by the backend) and a real trade message.
 */
import { describe, it, expect } from 'vitest'
import { decisionKindLabel, describeAction, describeEvents, nameOf, tradeText } from './eventText'
import full from '../../tests/unit/fixtures/transcript-full.json'
import { CLASSIC, MINI, VALLEY } from '../../tests/unit/fixtures/rulesets'
import { wireTrades } from '../../tests/unit/fixtures/wire'
import type { EngineEvent } from '../types/transcripts'

const entries = full.entries as Array<Record<string, any>>
const events = entries.filter((e) => e.type === 'event').map((e) => e.event as EngineEvent)
const names: Record<string, string> = Object.fromEntries(
  (full.header.seats as any[]).map((s) => [s.player_id, s.name])
)
const first = (type: string) => events.find((e) => e.type === type)!
const lineFor = (e: EngineEvent, rs = CLASSIC) =>
  describeEvents([e], names, rs).find((l) => l.type === e.type)!.text

describe('describeEvents on a real game', () => {
  // Built inside each test (not at collection) so each test is the one that exercises it.
  const linesOf = () => describeEvents(events, names, CLASSIC)

  it('every event reads as a sentence; a placement and the growth it causes are one line', () => {
    const lines = linesOf()
    const merged = events.filter(
      (e, i) =>
        e.type === 'tile_placed' &&
        events[i + 1]?.tile === e.tile &&
        ['chain_expanded', 'chain_founded'].includes(events[i + 1].type)
    ).length
    expect(merged).toBeGreaterThan(10)
    expect(lines).toHaveLength(events.length - merged)
    for (const l of lines) {
      expect(l.text, l.key).toMatch(/\S/)
      expect(l.text, l.key).not.toMatch(/undefined|NaN|\[object|null/)
    }
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length)
  })

  it('players are named, not shown by id', () => {
    const lines = linesOf()
    const text = lines.map((l) => l.text).join('\n')
    expect(text).not.toMatch(/llm_4808f498|bot_40cdc7b2|a09d5ccf/)
    expect(text).toContain('Dana')
    expect(text).toContain('Fake LLM (test)')
  })

  it('sentences carry the facts of the event', () => {
    const e = first('chain_founded') as any
    expect(lineFor(e)).toBe(
      `${names[e.player_id]} founded ${e.chain} (2 tiles) and received 1 free share.`
    )
    const m = first('merger_started') as any
    expect(lineFor(m)).toBe(`Merger: ${m.survivor} absorbs ${m.defunct.join(', ')}.`)
    const b = first('bonuses_paid') as any
    const [pid, v] = Object.entries<any>(b.bonuses)[0]
    expect(lineFor(b)).toBe(
      `Bonuses for ${b.chain}: ${names[pid]} $${v.majority.toLocaleString('en-US')} majority + $${v.minority.toLocaleString('en-US')} minority.`
    )
    const s = first('stock_disposition') as any
    expect(lineFor(s)).toBe(`${names[s.player_id]} ${s.defunct_chain} shares: kept ${s.hold}.`)
    const done = first('merger_completed') as any
    expect(lineFor(done)).toBe(
      `Merger complete: ${done.survivor} now has ${done.survivor_size} tiles.`
    )
  })

  it('a purchase names the shares and the price paid; buying nothing says so', () => {
    const nothing = first('stocks_purchased') as any
    expect(nothing.total_cost).toBe(0)
    expect(lineFor(nothing)).toBe(`${names[nothing.player_id]} bought no shares.`)
    const some = events.find(
      (e) => e.type === 'stocks_purchased' && (e as any).total_cost > 0
    ) as any
    const [chain, n] = Object.entries<number>(some.purchases)[0]
    expect(lineFor(some)).toContain(`bought ${n} ${chain}`)
    expect(lineFor(some)).toContain(`for $${some.total_cost.toLocaleString('en-US')}`)
  })

  it('placements: plain, expanding, and the end of the turn names who is up next', () => {
    const plain = events.find(
      (e) => e.type === 'tile_placed' && (e as any).outcome === 'nothing'
    ) as any
    expect(lineFor(plain)).toBe(`${names[plain.player_id]} placed ${plain.tile}.`)
    const end = first('turn_ended') as any
    expect(lineFor(end)).toBe(
      `${names[end.player_id]} ended their turn. ${names[end.next_player_id]} is up.`
    )
  })

  it('the end of the game: who declared it, and the winner', () => {
    const declared = first('end_game_declared') as any
    expect(lineFor(declared)).toBe(`${names[declared.player_id]} declared the game over.`)
    const over = first('game_ended') as any
    expect(lineFor(over)).toBe(`Game over (declared). Winner: ${over.standings[0].name}.`)
  })

  it('the start: turn order; dealt tiles; draws', () => {
    const start = first('game_started') as any
    expect(lineFor(start)).toBe(
      `Game started. Turn order: ${start.turn_order.map((p: string) => names[p]).join(', ')}.`
    )
    const dealt = first('tiles_dealt') as any
    expect(lineFor(dealt)).toBe(
      `${names[dealt.player_id]} was dealt ${dealt.tiles.length} tiles: ${dealt.tiles.join(', ')}.`
    )
    const drawn = first('tile_drawn') as any
    expect(lineFor(drawn)).toBe(`${names[drawn.player_id]} drew ${drawn.tile}.`)
  })

  it('what only the acting seat saw is flagged private', () => {
    const lines = linesOf()
    for (const l of lines) {
      const e = events.find((x) => `${x.seq}-${x.type}` === l.key)!
      expect(l.isPrivate, l.key).toBe(e.private_to != null)
    }
    expect(lines.some((l) => l.isPrivate)).toBe(true)
  })
})

describe('wording follows the ruleset of the game', () => {
  const merger = first('merger_started') as any
  const done = first('merger_completed') as any
  const buy = events.find((e) => e.type === 'stocks_purchased' && (e as any).total_cost === 0)!

  it.each([
    ['classic', CLASSIC],
    ['valley', VALLEY],
    ['mini', MINI],
  ])('%s: merger noun, share noun and chain founding come from the ruleset', (_n, rs) => {
    const cap = rs.theme.merger_noun[0].toUpperCase() + rs.theme.merger_noun.slice(1)
    expect(lineFor(merger, rs)).toMatch(new RegExp(`^${cap}: `))
    expect(lineFor(done, rs)).toMatch(new RegExp(`^${cap} complete: `))
    expect(lineFor(buy, rs)).toBe(
      `${names[(buy as any).player_id]} bought no ${rs.theme.share_noun_plural}.`
    )
    const placed = events.find(
      (e) => e.type === 'tile_placed' && (e as any).outcome === 'found'
    ) as any
    if (placed) {
      expect(lineFor(placed, rs)).toContain(`${rs.theme.chain_noun} can be founded`)
    }
  })

  it('cash founder bonuses are shown as money; a trade ratio sets how many shares a merger trade yields', () => {
    const founded = {
      ...(first('chain_founded') as any),
      founder_bonus_type: 'cash',
      founder_bonus_value: 500,
    }
    expect(lineFor(founded)).toContain('received $500 bonus')
    const dispo = {
      ...(first('stock_disposition') as any),
      sell: 2,
      trade: 4,
      hold: 1,
      sale_proceeds: 800,
      survivor_shares_received: undefined,
    }
    expect(lineFor(dispo)).toContain('sold 2 ($800), traded 4 for 2')
    expect(lineFor(dispo, { ...CLASSIC, merger_trade_ratio: 3 })).toContain('traded 4 for 1')
  })
})

describe('events a quiet game does not produce (field names as the engine writes them)', () => {
  const ev = (type: string, extra: Record<string, unknown>) =>
    ({ seq: 1, type, player_id: 'a', private_to: null, ...extra }) as unknown as EngineEvent
  const who = { a: 'Alice', b: 'Bob' }
  const text = (e: EngineEvent, rs = CLASSIC) => describeEvents([e], who, rs)[0].text

  it('tile placements say what they did to the board', () => {
    expect(
      text(ev('tile_placed', { tile: '5D', outcome: 'expand', chains: ['Luxor', 'Tower'] }))
    ).toBe('Alice placed 5D — Luxor and Tower grows.')
    expect(text(ev('tile_placed', { tile: '5D', outcome: 'found', chains: [] }))).toBe(
      'Alice placed 5D — a new hotel chain can be founded.'
    )
    expect(
      text(ev('tile_placed', { tile: '5D', outcome: 'merge', chains: ['Luxor', 'Tower'] }))
    ).toBe('Alice placed 5D — merger of Luxor and Tower.')
    expect(
      text(ev('tile_placed', { tile: '5D', outcome: 'merge_tie', chains: ['Luxor'] }))
    ).toContain('merger of Luxor')
    expect(text(ev('tile_placed', { tile: '5D', outcome: 'something_new' }))).toBe(
      'Alice placed 5D.'
    )
    expect(text(ev('tile_placed', { tile: '5D', outcome: 'found', chains: [] }), VALLEY)).toContain(
      'a new AI startup can be founded'
    )
  })

  it('a chain that grows by itself, and a tie that was broken', () => {
    expect(text(ev('chain_expanded', { chain: 'Luxor', size: 6 }))).toBe('Luxor grows to 6.')
    expect(text(ev('survivor_chosen', { survivor: 'Tower' }))).toBe(
      'Alice chose Tower to survive the tie.'
    )
  })

  it('unplayable tiles are replaced, or the placement is skipped', () => {
    expect(text(ev('tiles_replaced', { removed_tiles: ['1A', '2B'] }))).toBe(
      'Alice discarded 2 unplayable tiles (1A, 2B) and drew replacements.'
    )
    expect(text(ev('tiles_replaced', { removed_tiles: ['1A'] }))).toContain(
      '1 unplayable tile (1A)'
    )
    expect(text(ev('tiles_replaced', {}))).toContain('0 unplayable tiles')
    expect(text(ev('tile_placement_skipped', {}))).toBe(
      'Alice had no playable tile and skipped placement.'
    )
  })

  it('a merger payout with only a majority or minority bonus, and one nobody earned', () => {
    expect(
      text(
        ev('bonuses_paid', {
          chain: 'Luxor',
          final: false,
          bonuses: { a: { majority: 3000 }, b: { minority: 1500 } },
        })
      )
    ).toBe('Bonuses for Luxor: Alice $3,000 majority; Bob $1,500 minority.')
    expect(text(ev('bonuses_paid', { chain: 'Luxor', final: true, bonuses: {} }))).toBe(
      'Final bonuses for Luxor: none.'
    )
    expect(text(ev('bonuses_paid', { chain: 'Luxor', final: false, bonuses: { a: {} } }))).toBe(
      'Bonuses for Luxor: Alice $0.'
    )
  })

  it('selling, trading and holding in a merger, and doing nothing', () => {
    expect(
      text(
        ev('stock_disposition', {
          defunct_chain: 'Tower',
          surviving_chain: 'Luxor',
          sell: 1,
          trade: 0,
          hold: 0,
          sale_proceeds: 400,
        })
      )
    ).toBe('Alice Tower shares: sold 1 ($400).')
    expect(
      text(
        ev('stock_disposition', {
          defunct_chain: 'Tower',
          surviving_chain: 'Luxor',
          sell: 0,
          trade: 0,
          hold: 0,
        })
      )
    ).toBe('Alice Tower shares: nothing to dispose.')
  })

  it("trades: proposed, accepted, rejected and cancelled, with the engine's own trade record", () => {
    const t = wireTrades().proposed.trade
    const names2 = { [t.from_player_id]: 'Alice', [t.to_player_id]: 'Bob' }
    const line = (e: EngineEvent) => describeEvents([e], names2, CLASSIC)[0].text
    const tradeEv = (type: string, extra: Record<string, unknown> = {}) =>
      ({
        seq: 1,
        type,
        player_id: t.from_player_id,
        private_to: null,
        trade: t,
        ...extra,
      }) as unknown as EngineEvent
    expect(line(tradeEv('trade_proposed'))).toBe(
      'Alice proposed a trade: Alice gives $500 for 1 Continental from Bob.'
    )
    expect(line(tradeEv('trade_accepted'))).toBe(
      'Alice accepted the trade: Alice gives $500 for 1 Continental from Bob.'
    )
    expect(line(tradeEv('trade_rejected'))).toBe('Alice rejected a trade offer.')
    expect(line(tradeEv('trade_cancelled', { reason: 'merger_started' }))).toBe(
      'A trade offer was cancelled (merger started).'
    )
    expect(line(tradeEv('trade_cancelled'))).toBe('A trade offer was cancelled (cancelled).')
  })

  it("a game that ends without standings names no winner; a standing without a name uses the player's name", () => {
    expect(text(ev('game_ended', { reason: 'no_more_tiles', standings: [] }))).toBe(
      'Game over (no more tiles).'
    )
    expect(text(ev('game_ended', { reason: 'declared', standings: [{ player_id: 'b' }] }))).toBe(
      'Game over (declared). Winner: Bob.'
    )
    expect(text(ev('game_ended', {}))).toBe('Game over (ended).')
  })

  it('a standalone placement is not merged with a growth of a different tile', () => {
    const lines = describeEvents(
      [
        ev('tile_placed', { tile: '5D', outcome: 'expand', chains: ['Luxor'] }),
        { ...ev('chain_expanded', { chain: 'Luxor', size: 4, tile: '6E' }), seq: 2 },
      ],
      who,
      CLASSIC
    )
    expect(lines).toHaveLength(2)
  })

  it('a chain founded right after the placement reads as one line, with a cash bonus when the ruleset gives cash', () => {
    const [line] = describeEvents(
      [
        ev('tile_placed', { tile: '5D', outcome: 'found', chains: [] }),
        {
          ...ev('chain_founded', {
            chain: 'Luxor',
            tile: '5D',
            size: 2,
            founder_bonus_type: 'cash',
            founder_bonus_value: 500,
          }),
          seq: 2,
        },
      ],
      who,
      CLASSIC
    )
    expect(line.text).toMatch(/^Alice placed 5D — founded Luxor \(2 tiles\) and received \$500/)
  })

  it("a founder bonus without a value is the ruleset's own number of free shares", () => {
    const t = text(
      ev('chain_founded', { chain: 'Luxor', size: 2, founder_bonus_type: 'stock' }),
      MINI
    )
    expect(t).toContain(`${MINI.founder_bonus_shares} free shares`)
  })

  it('values in the unknown-event line: objects as JSON, the rest as text; no player gives no prefix', () => {
    const odd = {
      seq: 7,
      type: 'bank_audit',
      player_id: 'x',
      private_to: null,
      ok: true,
      detail: { a: 1 },
    }
    expect(describeEvents([odd as never], {}, CLASSIC)[0].text).toBe(
      'x: bank audit (ok=true, detail={"a":1})'
    )
    expect(
      describeEvents(
        [{ seq: 8, type: 'ping', player_id: null, private_to: null } as never],
        {},
        CLASSIC
      )[0].text
    ).toBe('ping')
  })

  it('a merger trade at 2:1: shares received default to half the shares traded', () => {
    const t = text(
      ev('stock_disposition', {
        defunct_chain: 'Tower',
        surviving_chain: 'Luxor',
        sell: 0,
        trade: 6,
        hold: 0,
      })
    )
    expect(t).toBe('Alice Tower shares: traded 6 for 3 Luxor.')
  })
})

describe('events the viewer does not know', () => {
  it('are shown as "type (key=value, ...)" rather than dropped', () => {
    const odd = {
      seq: 7,
      type: 'bank_audit',
      player_id: null,
      private_to: null,
      total: 3,
      detail: { a: 1 },
    }
    expect(describeEvents([odd as never], names, CLASSIC)[0].text).toBe(
      'bank audit (total=3, detail={"a":1})'
    )
  })
})

describe('trades in words', () => {
  it('a real proposal: who gives what for what', () => {
    const t = wireTrades().proposed.trade
    const ids = { [t.from_player_id]: 'Alice', [t.to_player_id]: 'Bob' }
    expect(tradeText(t, ids, CLASSIC)).toBe('Alice gives $500 for 1 Continental from Bob')
  })

  it('nothing on a side reads "nothing"; no trade at all reads "a trade"', () => {
    expect(tradeText({ from_player_id: 'a', to_player_id: 'b' }, {}, CLASSIC)).toBe(
      'a gives nothing for nothing from b'
    )
    expect(tradeText(undefined, {}, CLASSIC)).toBe('a trade')
  })

  it('names fall back to the id, and a missing player is "The game"', () => {
    expect(nameOf({ a: 'Alice' }, 'a')).toBe('Alice')
    expect(nameOf({}, 'zed')).toBe('zed')
    expect(nameOf({}, null)).toBe('The game')
  })
})

describe('describeAction and decisionKindLabel', () => {
  const decisions = entries.filter((e) => e.type === 'decision')
  const action = (a: string) => decisions.find((d) => d.action.action === a)!.action

  it('real actions read as short commands', () => {
    const place = action('place_tile')
    expect(describeAction(place, CLASSIC)).toBe(`place ${place.tile}`)
    const found = action('found_chain')
    expect(describeAction(found, CLASSIC)).toBe(`found ${found.chain}`)
    const disposition = action('merger_disposition')
    const d = disposition.disposition
    expect(describeAction(disposition, CLASSIC)).toBe(
      `${disposition.defunct_chain}: sell ${d.sell} / trade ${d.trade} / hold ${d.hold}`
    )
    expect(describeAction(action('end_turn'), CLASSIC)).toBe('end turn')
    expect(describeAction(action('declare_end_game'), CLASSIC)).toBe('declare game over')
  })

  it('buying: the shares, or "buy nothing"', () => {
    const buys = decisions.filter((d) => d.action.action === 'buy_stocks').map((d) => d.action)
    const some = buys.find((a) => Object.values<number>(a.purchases).some((n) => n > 0))
    if (some) {
      const [chain, n] = Object.entries<number>(some.purchases).find(([, q]) => q > 0)!
      expect(describeAction(some, CLASSIC)).toContain(`${n} ${chain}`)
    }
    expect(describeAction({ action: 'buy_stocks', purchases: {} }, CLASSIC)).toBe('buy nothing')
  })

  it('other actions, a tie choice, and the empty cases', () => {
    expect(describeAction({ action: 'merger_choice', surviving_chain: 'Tower' }, CLASSIC)).toBe(
      'keep Tower'
    )
    expect(describeAction({ action: 'propose_trade' }, CLASSIC)).toBe('propose trade')
    expect(describeAction({ action: 'accept_trade' }, CLASSIC)).toBe('accept trade')
    expect(describeAction({ action: 'reject_trade' }, CLASSIC)).toBe('reject trade')
    expect(describeAction({ action: 'cancel_trade' }, CLASSIC)).toBe('cancel trade')
    expect(describeAction({ action: 'place_tile' }, CLASSIC)).toBe('place (no tile)')
    expect(describeAction({ action: 'do_something_new' }, CLASSIC)).toBe('do something new')
    expect(describeAction({}, CLASSIC)).toBe('—')
    expect(describeAction(null, CLASSIC)).toBe('—')
  })

  it('every kind of decision in the game has a label in the ruleset words', () => {
    const kinds = [...new Set(decisions.map((d) => d.kind as string))]
    expect(kinds.length).toBeGreaterThan(3)
    expect(decisionKindLabel('place_tile', CLASSIC)).toBe('Place a tile')
    expect(decisionKindLabel('found_chain', CLASSIC)).toBe('Found a hotel chain')
    expect(decisionKindLabel('found_chain', VALLEY)).toBe('Found an AI startup')
    expect(decisionKindLabel('buy_stocks', MINI)).toBe('Buy shares')
    expect(decisionKindLabel('stock_disposition', CLASSIC)).toBe('Merger shares')
    expect(decisionKindLabel('choose_survivor', CLASSIC)).toBe('Choose survivor')
    expect(decisionKindLabel('trade_response', CLASSIC)).toBe('Answer a trade')
    expect(decisionKindLabel('something_else', CLASSIC)).toBe('something else')
  })
})
