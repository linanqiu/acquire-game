import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addSeat,
  describeFallbacks,
  fetchAgentCatalog,
  isAiThinking,
  removeSeat,
  resolveSeatKind,
  seatKindLabel,
} from './agents'
import { playedGame, wireCatalog } from '../../tests/unit/fixtures/wire'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('what a seat is called', () => {
  const [human, bot, scripted] = playedGame('default').lobby.players

  it('real seats: a human, a rules-based bot and a scripted seat', () => {
    expect(resolveSeatKind(human)).toBe('human')
    expect(resolveSeatKind(bot)).toBe('bot')
    expect(resolveSeatKind(scripted)).toBe('scripted')
    expect(seatKindLabel(human)).toBe('HUMAN')
    expect(seatKindLabel(bot)).toBe('BOT')
    // The server names the scripted agent; that label wins over the kind.
    expect(seatKindLabel(scripted)).toBe('Scripted')
  })

  it('an AI seat with no label is "AI"; the kind comes from is_bot when the server sends no kind', () => {
    expect(seatKindLabel({ kind: 'llm' })).toBe('AI')
    expect(seatKindLabel({ kind: 'scripted' })).toBe('SCRIPTED')
    expect(resolveSeatKind({ is_bot: true })).toBe('bot')
    expect(resolveSeatKind({ kind: 'llm', is_bot: false })).toBe('llm')
    expect(resolveSeatKind({})).toBe('human')
  })
})

describe('describeFallbacks (the tooltip of "BOT ASSIST")', () => {
  it('counts the times and says why it happened last', () => {
    expect(describeFallbacks({ count: 1, last_reason: 'timeout' })).toBe(
      'Rules-based player moved for this seat 1 time (last: timed out)'
    )
    expect(describeFallbacks({ count: 3, last_reason: 'illegal' })).toBe(
      'Rules-based player moved for this seat 3 times (last: kept answering illegally)'
    )
    expect(describeFallbacks({ count: 2, last_reason: 'error' })).toContain(
      '(last: provider error)'
    )
    expect(describeFallbacks({ count: 2, last_reason: 'cap' })).toContain(
      '(last: hit the per-turn action limit)'
    )
  })

  it('no reason known: no "last" part; a reason this version does not know is shown as sent', () => {
    expect(describeFallbacks({ count: 2, last_reason: null })).toBe(
      'Rules-based player moved for this seat 2 times'
    )
    expect(describeFallbacks({ count: 2, last_reason: 'gremlins' as never })).toContain(
      '(last: gremlins)'
    )
  })
})

describe('isAiThinking', () => {
  it('is true only for the seat the engine waits on, and only when that seat is not a human', () => {
    const awaiting = { player_id: 'p1', kind: 'llm' as const, decision: 'place_tile' }
    expect(isAiThinking(awaiting, 'p1')).toBe(true)
    expect(isAiThinking(awaiting, 'p2')).toBe(false)
    expect(isAiThinking({ ...awaiting, kind: 'bot' }, 'p1')).toBe(true)
    expect(isAiThinking({ ...awaiting, kind: 'human' }, 'p1')).toBe(false)
    expect(isAiThinking(null, 'p1')).toBe(false)
    expect(isAiThinking(undefined, 'p1')).toBe(false)
  })
})

describe('talking to the server about AI seats', () => {
  it("the catalog is the server's list, fetched from /api/agents/catalog", async () => {
    const fn = vi.fn(async () => json(wireCatalog()))
    vi.stubGlobal('fetch', fn)
    const catalog = await fetchAgentCatalog()
    expect(catalog).toEqual(wireCatalog())
    expect(String((fn.mock.calls[0] as unknown[])[0])).toBe('/api/agents/catalog')
  })

  it('a failing catalog request or a body that is not a list is an error (the page then offers plain ADD BOT)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ detail: 'Not Found' }, 404))
    )
    await expect(fetchAgentCatalog()).rejects.toThrow('Catalog request failed (404)')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ not: 'a list' }))
    )
    await expect(fetchAgentCatalog()).rejects.toThrow('Unexpected catalog response')
  })

  it('adding a seat POSTs the agent id as JSON to the room and returns what the server made', async () => {
    const fn = vi.fn(async () => json({ player_id: 'p9', name: 'Bot 2', kind: 'bot' }))
    vi.stubGlobal('fetch', fn)
    expect(await addSeat('ABCD', 'bot')).toEqual({ player_id: 'p9', name: 'Bot 2', kind: 'bot' })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/room/ABCD/add-seat')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ agent_id: 'bot' })
  })

  it('a refused add or remove is an error with a message for the player', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 400))
    )
    await expect(addSeat('ABCD', 'bot')).rejects.toThrow('Failed to add AI opponent')
    await expect(removeSeat('ABCD', 'p9')).rejects.toThrow('Failed to remove AI opponent')
  })

  it("removing a seat POSTs to the seat's own route", async () => {
    const fn = vi.fn(async () => json({}))
    vi.stubGlobal('fetch', fn)
    await removeSeat('ABCD', 'p9')
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/room/ABCD/remove-seat/p9')
    expect(init.method).toBe('POST')
  })
})
