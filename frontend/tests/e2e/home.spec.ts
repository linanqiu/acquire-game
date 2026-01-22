import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
  test('displays the welcome message', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /acquire/i })).toBeVisible()
  })

  test('shows lobby page content', async ({ page }) => {
    await page.goto('/')
    // Lobby page shows "Acquire" and description
    await expect(page.getByText(/board game/i)).toBeVisible()
  })
})

test.describe('Routing', () => {
  // These tests are skipped because they try to access non-existent rooms.
  // With WebSocket integration, the page shows a connection error state
  // instead of rendering the room code. Real room creation is tested in lobby.spec.ts.
  test.skip('player route shows room code and waiting state', async ({ page }) => {
    await page.goto('/play/ABCD')
    // Room code appears in header, use first() to avoid strict mode violation
    await expect(page.getByText('ABCD').first()).toBeVisible()
    // Player view shows waiting for host status - appears in multiple places
    await expect(page.getByText(/waiting for host/i).first()).toBeVisible()
  })

  test.skip('host route shows room code and host controls', async ({ page }) => {
    await page.goto('/host/WXYZ')
    // Room code appears in header, use first() to avoid strict mode violation
    await expect(page.getByText('WXYZ').first()).toBeVisible()
    // Host view shows player count heading - appears in multiple places
    await expect(page.getByText(/players/i).first()).toBeVisible()
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/unknown/route')
    await expect(page.getByText('404')).toBeVisible()
  })

  test.skip('room code is case insensitive (uppercased)', async ({ page }) => {
    await page.goto('/play/abcd')
    // Room code appears in multiple places, use first() to avoid strict mode violation
    await expect(page.getByText('ABCD').first()).toBeVisible()
  })
})
