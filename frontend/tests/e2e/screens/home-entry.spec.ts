import { test, expect } from './support/test'

// Small behaviours of the home page forms that no journey spends time on.

test('names are trimmed on create and join, and the host is marked in the URL', async ({
  page,
  browser,
  guard,
  shots,
}) => {
  await page.goto('/')
  await page.getByTestId('name-input').fill('   Alice   ')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}\?is_host=1/)
  const code = /\/play\/([A-Z0-9]{4})/.exec(page.url())![1]
  const hostRow = page.locator('[data-testid^="lobby-player-"]').first()
  await expect(hostRow).toHaveText(/^Alice\b/)
  await expect(page.locator('[data-testid^="lobby-player-"]')).toHaveCount(1)
  await shots.take(page, 'host-lobby-trimmed-name')

  // A second browser joins with a padded name and a lower-case code.
  const ctx = await browser.newContext()
  const guest = await ctx.newPage()
  guard.watch(guest, 'guest')
  await guest.goto('/')
  await guest.getByTestId('name-input').fill('  Bea  ')
  await guest.getByTestId('join-button').click()
  await expect(guest.getByTestId('join-as')).toHaveText(/Joining as Bea\b/)
  // Lower case and stray characters are cleaned as typed; the fourth letter joins.
  await guest.getByTestId('join-room-input').pressSequentially(code.slice(0, 3).toLowerCase())
  await expect(guest.getByTestId('join-room-input')).toHaveValue(code.slice(0, 3))
  await guest.getByTestId('join-room-input').press(code[3].toLowerCase())
  await guest.waitForURL(new RegExp(`/play/${code}$`))
  await expect(guest.locator('[data-testid^="lobby-player-"]')).toHaveCount(2)
  await expect(
    guest.locator('[data-testid^="lobby-player-"]').filter({ hasText: /^Bea\b/ })
  ).toHaveCount(1)
  // The host sees the trimmed name too, and a guest does not get the host's controls.
  await expect(
    page.locator('[data-testid^="lobby-player-"]').filter({ hasText: /^Bea\b/ })
  ).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'START GAME' })).toBeVisible()
  await expect(guest.getByRole('button', { name: 'START GAME' })).toHaveCount(0)
  await expect(guest.getByTestId('game-phase')).toHaveText('WAITING FOR THE HOST TO START')
  await shots.take(guest, 'guest-lobby')
  await ctx.close()
})

test('one question at a time: name, then NEW GAME or JOIN GAME; the code step and Back', async ({
  page,
  shots,
}) => {
  await page.goto('/')
  // Step one: only the name, and two choices; the other destinations are quiet links.
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await expect(page.getByLabel('Your name')).toHaveCount(1)
  await expect(page.getByTestId('name-input')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'NEW GAME' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'JOIN GAME' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'More' }).getByRole('link')).toHaveCount(2)
  await shots.take(page, 'step-name')

  // JOIN GAME without a name: said at the name field, nothing else changes.
  await page.getByTestId('join-button').click()
  await expect(page.locator('#player-name-error')).toHaveText('Name is required')
  await expect(page.getByTestId('name-input')).toBeFocused()
  await expect(page).toHaveURL(/\/$/)

  // With a name: the code step, in the URL, with the cursor in the code field.
  await page.getByTestId('name-input').fill('Ada')
  await page.getByTestId('join-button').click()
  await expect(page).toHaveURL(/\/\?join/)
  await expect(page.getByTestId('join-room-input')).toBeFocused()
  await expect(page.getByTestId('join-room-input')).toHaveAccessibleName('Room code')
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await expect(page.getByTestId('join-as')).toHaveText(/Joining as Ada/)
  await shots.take(page, 'step-code')

  // The browser's Back button returns to the name, with the name kept.
  await page.goBack()
  await expect(page.getByTestId('create-button')).toBeVisible()
  await expect(page.getByTestId('name-input')).toHaveValue('Ada')
  await page.goForward()
  await expect(page.getByTestId('join-room-input')).toBeVisible()
  // So does the page's own Back.
  await page.getByTestId('join-back').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('name-input')).toBeFocused()
})

test('the name is remembered: back on the home page it is filled in', async ({ page, shots }) => {
  await page.goto('/')
  await expect(page.getByTestId('name-input')).toHaveValue('')
  await page.getByTestId('name-input').fill('Ada')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z0-9]{4}\?is_host=1/)
  await page.goto('/')
  await expect(page.getByTestId('name-input')).toHaveValue('Ada')
  await shots.take(page, 'name-remembered')
})

test('join link: the lobby invite opens the code step with the code filled in', async ({
  page,
  browser,
  guard,
  shots,
}) => {
  await page.goto('/')
  await page.getByTestId('name-input').fill('Hana')
  await page.getByTestId('create-button').click()
  await page.waitForURL(/\/play\/[A-Z]{4}\?is_host=1/)
  const code = /\/play\/([A-Z]{4})/.exec(page.url())![1]
  const invite = page.getByTestId('lobby-share')
  await expect(invite).toBeVisible()
  const href = (await invite.getAttribute('href'))!
  expect(new URL(href).pathname).toBe('/')
  expect(new URL(href).searchParams.get('code')).toBe(code)
  // Pressing it shares the link (a desktop browser without a share sheet copies it).
  await invite.click()
  await expect(page.getByTestId('lobby-share-outcome')).toBeVisible()
  await shots.take(page, 'lobby-invite')

  // A friend opens the link: the code step, code filled in, asking their name first.
  const ctx = await browser.newContext()
  const friend = await ctx.newPage()
  guard.watch(friend, 'friend')
  await friend.goto(href)
  await expect(friend.getByTestId('join-room-input')).toHaveValue(code)
  await expect(friend.getByTestId('name-input')).toBeVisible()
  await shots.take(friend, 'link-no-name')
  await friend.getByTestId('name-input').fill('Bea')
  await friend.getByTestId('join-submit-button').click()
  await friend.waitForURL(new RegExp(`/play/${code}$`))
  await expect(friend.locator('[data-testid^="lobby-player-"]')).toHaveCount(2)

  // The next link this browser opens knows the name: one tap joins.
  await friend.goto(href.replace(code, 'QZQZ'))
  await expect(friend.getByTestId('join-as')).toHaveText(/Joining as Bea/)
  await expect(friend.getByTestId('join-room-input')).toBeFocused()
  await shots.take(friend, 'link-name-known')
  await ctx.close()
})
