import type { WebSocketRoute } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'

test('host page: connection drops mid-game, reconnecting overlay, then the board is live again', async ({
  page,
  browser,
  guard,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'three-player-midgame')

  // The spectator view of the same room, in its own context, with its socket under our control.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const host = await ctx.newPage()
  guard.watch(host, 'host')
  const sockets: WebSocketRoute[] = []
  let allowConnect = true
  await host.routeWebSocket(/\/ws\/host\//, (ws) => {
    sockets.push(ws)
    if (allowConnect) ws.connectToServer()
    else ws.close({ code: 1000, reason: 'blocked by test' })
  })
  await host.goto(`/host/${room.code}`)
  await expect(host.getByTestId('board')).toBeVisible()
  const cards = host.getByTestId('player-card')
  await expect(cards).toHaveCount(room.fixture.expect.players.length)

  allowConnect = false
  await sockets[sockets.length - 1].close({ code: 1000, reason: 'dropped by test' })
  await expect(host.getByText('RECONNECTING...')).toBeVisible()
  await shots.take(host, 'host-reconnecting')

  allowConnect = true
  await expect(host.getByText('RECONNECTING...')).toHaveCount(0, { timeout: 20000 })
  await expect(host.getByTestId('board')).toBeVisible()
  await expect(cards).toHaveCount(room.fixture.expect.players.length)
  await shots.take(host, 'host-back')
  await ctx.close()
})
