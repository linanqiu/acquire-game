/**
 * Tier-3 room setup: create the game through the home page UI, add opponent seats, then load
 * a generated snapshot fixture instead of playing to the screen under test.
 *
 * API use here is allowed in tier 3 only (see CLAUDE.md "Test Policy: Four Tiers"):
 *  - POST /api/room/{code}/add-seat {agent_id:"scripted"}: the lobby UI does not offer scripted
 *    seats. Scripted seats answer instantly with first-legal moves (reject trades, sell defunct
 *    stock, buy nothing).
 *  - POST /api/join for "idle" seats: a human seat nobody drives. Used where a screen needs an
 *    opponent who does NOT answer (waiting on another player, a trade that stays pending).
 *  - POST /api/test/room/{code}/load-snapshot (test mode only).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { loadFixture, type Fixture } from './fixtures'

export interface StartOptions {
  /** Snapshot seat ids (e.g. "p3") that are idle humans instead of scripted seats. */
  idle?: string[]
  /** Optional script for scripted seats, keyed by snapshot seat id. */
  scripts?: Record<string, unknown[]>
  /** Browser viewport; default 1280x900 (screenshots are full-page). */
  viewport?: { width: number; height: number }
}

export interface RoomContext {
  code: string
  fixture: Fixture
  /** The browser player's real (room) player id. */
  humanId: string
  /** snapshot seat id -> room player id, for every seat. */
  seatMap: Record<string, string>
  /** Idle human seats by snapshot seat id -> room player id. */
  idleIds: Record<string, string>
  /** Names by room player id. */
  names: Record<string, string>
  request: APIRequestContext
  /** Let idle seats act when it is their turn (first legal move). Returns true if any acted. */
  driveIdle: () => Promise<boolean>
  /** Post a raw action for a room player id through the HTTP action route. */
  act: (playerId: string, action: Record<string, unknown>) => Promise<ActionResult>
  /** Live game as a snapshot (test-mode route). */
  liveSnapshot: () => Promise<LiveSnapshot>
}

export interface ActionResult {
  status: string
  phase?: string
  current_player?: string
  your_hand?: string[]
  error?: string
}

export interface LiveSnapshot {
  phase: string
  current_player_index: number
  pending_action: Record<string, unknown> | null
  pending_trades: Array<Record<string, unknown>>
  players: Array<{
    player_id: string
    money: number
    hand: string[]
    stocks: Record<string, number>
  }>
}

export async function startFromSnapshot(
  page: Page,
  fixtureName: string,
  opts: StartOptions = {}
): Promise<RoomContext> {
  const fixture = loadFixture(fixtureName)
  const request = page.request
  const snapPlayers = (fixture.snapshot.players as Array<{ player_id: string }>).map(
    (p) => p.player_id
  )
  const nameOf = (seat: string) =>
    fixture.expect.players.find((p) => p.player_id === seat)?.name ?? seat

  await page.setViewportSize(opts.viewport ?? { width: 1280, height: 900 })

  // 1. Home page -> create game, as a user would.
  await page.goto('/')
  await page.getByTestId('name-input').fill(nameOf(fixture.human_seat))
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const humanId = await page.evaluate(() => sessionStorage.getItem('player_id') ?? '')
  expect(humanId, 'create stores the player id in sessionStorage').not.toBe('')

  // 2. Opponent seats (in snapshot order so the room's seat order is stable).
  const seatMap: Record<string, string> = { [fixture.human_seat]: humanId }
  const idleIds: Record<string, string> = {}
  const names: Record<string, string> = { [humanId]: nameOf(fixture.human_seat) }
  for (const seat of snapPlayers) {
    if (seat === fixture.human_seat) continue
    if (opts.idle?.includes(seat)) {
      const res = await request.post('/api/join', {
        form: { room_code: code, player_name: nameOf(seat) },
      })
      expect(res.ok(), `join idle seat ${seat}`).toBeTruthy()
      const body = (await res.json()) as { player_id: string }
      seatMap[seat] = body.player_id
      idleIds[seat] = body.player_id
    } else {
      const res = await request.post(`/api/room/${code}/add-seat`, {
        data: { agent_id: 'scripted', name: nameOf(seat), script: opts.scripts?.[seat] },
      })
      expect(res.ok(), `add scripted seat ${seat}: ${await res.text()}`).toBeTruthy()
      seatMap[seat] = ((await res.json()) as { player_id: string }).player_id
    }
    names[seatMap[seat]] = nameOf(seat)
  }

  // The page must be listening before the game starts: a scripted seat can act the moment
  // the snapshot is loaded (e.g. answer a trade offer), and what the server sends then goes
  // only to sockets that are open. Every seat showing in the lobby proves this page's socket
  // is connected and delivering (the list comes over it). Without this wait the API calls
  // above could finish before the socket opened, and the page then missed those messages
  // (the cause of the intermittent "scripted opponent accepts/rejects" toast failures).
  for (const id of Object.values(seatMap)) {
    await expect(page.getByTestId(`lobby-player-${id}`), 'lobby lists every seat').toBeVisible()
  }

  // 3. Load the snapshot (this replaces pressing START and playing).
  const load = await request.post(`/api/test/room/${code}/load-snapshot`, {
    data: { snapshot: fixture.snapshot, seat_map: seatMap },
  })
  expect(load.ok(), `load snapshot ${fixtureName}: ${await load.text()}`).toBeTruthy()
  const loaded = (await load.json()) as { phase: string }
  expect(loaded.phase).toBeTruthy()

  // The page leaves the lobby once the game state arrives over the WebSocket.
  await expect(page.getByTestId('game-phase')).toBeVisible()

  const act = async (playerId: string, action: Record<string, unknown>) => {
    const res = await request.post(`/api/room/${code}/action/${playerId}`, { data: action })
    return (await res.json()) as ActionResult
  }
  const liveSnapshot = async () => {
    const res = await request.get(`/api/test/room/${code}/snapshot`)
    return (await res.json()) as LiveSnapshot
  }

  const idleSet = new Set(Object.values(idleIds))

  const driveIdle = async (): Promise<boolean> => {
    if (idleSet.size === 0) return false
    let acted = false
    for (let guard = 0; guard < 30; guard++) {
      const snap = await liveSnapshot()
      if (snap.phase === 'game_over') return acted
      // Offers addressed to an idle seat: reject (what a scripted seat does).
      const offer = snap.pending_trades.find((t) => idleSet.has(String(t.to_player_id)))
      if (offer) {
        await act(String(offer.to_player_id), {
          action: 'reject_trade',
          trade_id: offer.trade_id,
        })
        acted = true
        continue
      }
      const pa = snap.pending_action
      const current = snap.players[snap.current_player_index]
      const who = String((pa && pa.player_id) ?? current.player_id)
      if (!idleSet.has(who)) return acted
      const me = snap.players.find((p) => p.player_id === who)!
      let candidates: Array<Record<string, unknown>> = []
      if (pa?.type === 'stock_disposition') {
        candidates = [
          {
            action: 'merger_disposition',
            defunct_chain: pa.defunct_chain,
            disposition: { sell: pa.stock_count, trade: 0, hold: 0 },
          },
        ]
      } else if (pa?.type === 'choose_survivor') {
        candidates = (pa.tied_chains as string[]).map((c) => ({
          action: 'merger_choice',
          surviving_chain: c,
        }))
      } else if (pa?.type === 'found_chain') {
        candidates = (pa.available_chains as string[]).map((c) => ({
          action: 'found_chain',
          chain: c,
        }))
      } else if (snap.phase === 'buying_stocks') {
        candidates = [{ action: 'end_turn' }]
      } else {
        candidates = me.hand.map((t) => ({ action: 'place_tile', tile: t }))
      }
      let ok = false
      for (const c of candidates) {
        if ((await act(who, c)).status === 'ok') {
          ok = true
          break
        }
      }
      if (!ok) return acted // nothing legal found: let the test fail on its own assertions
      acted = true
    }
    return acted
  }

  return {
    code,
    fixture,
    humanId,
    seatMap,
    idleIds,
    names,
    request,
    driveIdle,
    act,
    liveSnapshot,
  }
}
