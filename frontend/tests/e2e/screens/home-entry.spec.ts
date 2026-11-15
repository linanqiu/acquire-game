import { test, expect } from './support/test'

// Small behaviours of the home page forms that no journey spends time on.

test('names are trimmed on create and join, and the host is marked in the URL', async ({
  page,
  browser,
  guard,
  shots,
}) => {
  await page.goto('/')
  await page.getByTestId('create-name-input').fill('   Alice   ')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}\?is_host=1/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const hostRow = page.locator('[data-testid^="lobby-player-"]').first()
  await expect(hostRow).toHaveText(/^Alice\b/)
  await expect(page.getByText('1/6 players')).toBeVisible()
  await shots.take(page, 'host-lobby-trimmed-name')

  // A second browser joins with a padded name and a lower-case code.
  const ctx = await browser.newContext()
  const guest = await ctx.newPage()
  guard.watch(guest, 'guest')
  await guest.goto('/')
  await guest.getByTestId('join-name-input').fill('  Bea  ')
  await guest.getByTestId('join-room-input').fill(code.toLowerCase())
  await expect(guest.getByTestId('join-room-input')).toHaveValue(code)
  await guest.getByTestId('join-button').click()
  await guest.waitForURL(new RegExp(`/play/${code}$`))
  await expect(guest.getByText('2/6 players')).toBeVisible()
  await expect(
    guest.locator('[data-testid^="lobby-player-"]').filter({ hasText: /^Bea\b/ })
  ).toHaveCount(1)
  // The host sees the trimmed name too, and a guest does not get the host's controls.
  await expect(
    page.locator('[data-testid^="lobby-player-"]').filter({ hasText: /^Bea\b/ })
  ).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'START GAME' })).toHaveCount(0)
  await expect(guest.getByTestId('game-phase')).toHaveText('WAITING FOR HOST')
  await shots.take(guest, 'guest-lobby')
  await ctx.close()
})
