import type { WebSocketRoute } from '@playwright/test'
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { myCash, phaseBanner, playHumanTurns } from './support/ui'

test('connection drops mid-game: reconnecting overlay, then a welcome-back card on the same screen', async ({
  page,
  shots,
}) => {
  // Every player WebSocket goes through a route we control, so the test can drop it and
  // hold the next connection attempt back while the overlay is on screen.
  const sockets: WebSocketRoute[] = []
  let allowConnect = true
  await page.routeWebSocket(/\/ws\/player\//, (ws) => {
    sockets.push(ws)
    if (allowConnect) {
      ws.connectToServer()
    } else {
      ws.close({ code: 1000, reason: 'blocked by test' })
    }
  })

  const room = await startFromSnapshot(page, 'buy-phase-multi-chain')
  const { human } = room.fixture.expect
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')

  // Drop the connection and refuse reconnects for now.
  allowConnect = false
  await sockets[sockets.length - 1].close({ code: 1000, reason: 'dropped by test' })
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('RECONNECTING...')).toBeVisible()
  await shots.take(page, 'reconnecting-overlay')

  // Let the next attempt through: the overlay goes, a welcome-back card shows the state.
  allowConnect = true
  const toast = page.getByTestId('reconnected-toast')
  await expect(toast).toBeVisible({ timeout: 20000 })
  await expect(page.getByText('RECONNECTING...')).toHaveCount(0)
  await expect(toast).toContainText(dollars(human.cash))
  await shots.take(page, 'welcome-back')
  await page.getByTestId('continue-playing').click()
  await expect(toast).toHaveCount(0)

  // The game is live again: same buy screen, and real turns still work.
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(myCash(page)).toHaveText(dollars(human.cash))
  await playHumanTurns(page, room, 3, shots)
})
