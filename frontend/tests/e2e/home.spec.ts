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
  test('player route shows room code', async ({ page }) => {
    await page.goto('/play/ABCD')
    // Room code appears in header, use first() to avoid strict mode violation
    await expect(page.getByText('ABCD').first()).toBeVisible()
    await expect(page.getByText(/player view/i)).toBeVisible()
  })

  test('host route shows room code', async ({ page }) => {
    await page.goto('/host/WXYZ')
    // Room code appears in header, use first() to avoid strict mode violation
    await expect(page.getByText('WXYZ').first()).toBeVisible()
    await expect(page.getByText(/host view/i)).toBeVisible()
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/unknown/route')
    await expect(page.getByText('404')).toBeVisible()
  })

  test('room code is case insensitive (uppercased)', async ({ page }) => {
    await page.goto('/play/abcd')
    // Room code appears in multiple places, use first() to avoid strict mode violation
    await expect(page.getByText('ABCD').first()).toBeVisible()
  })
})
