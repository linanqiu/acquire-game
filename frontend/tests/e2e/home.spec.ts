import { test, expect } from '@playwright/test'

test.describe('Home Page', () => {
  test('displays the welcome message', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /acquire/i })).toBeVisible()
  })

  test('navigates to lobby', async ({ page }) => {
    await page.goto('/')
    await page.click('text=Enter Lobby')
    await expect(page.getByRole('heading', { name: /game lobby/i })).toBeVisible()
  })
})
