import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { money, phaseBanner, playerRow } from './support/ui'

// Majority/minority bonuses are an engine rule (tier 1: test_mergers, test_complex_mergers). What
// only a browser test can show is that the players panel and the header follow the payout.

test('merger payout: bonuses reach the defunct chain stockholders on screen, nobody else', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'merger-survivor-tie')
  const { human, players, decisions } = room.fixture.expect
  const tied = decisions[0].legal.chains as string[]
  const [survivor, defunct] = [tied[1], tied[0]]
  await shots.take(page, 'survivor-choice')

  // Before the choice nobody has been paid: the panel shows the fixture's cash.
  for (const p of players) {
    await expect(playerRow(page, p.name)).toContainText(dollars(p.cash))
  }

  await page.getByTestId(`chain-button-${survivor.toLowerCase()}`).click()
  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR STOCK')

  // The server's own books after the merger started (live snapshot, test-mode route).
  const live = await room.liveSnapshot()
  const moneyOf = (seat: string) =>
    live.players.find((p) => p.player_id === room.seatMap[seat])!.money

  // The two players tied for the most defunct shares are paid; the screen shows the same sums.
  const holders = players
    .map((p) => ({ ...p, held: p.holdings[defunct] ?? 0 }))
    .filter((p) => p.held > 0)
    .sort((a, b) => b.held - a.held)
  const top = holders[0].held
  const paid = holders.filter((p) => p.held === top)
  expect(paid.length, 'fixture has a tie for the majority').toBeGreaterThan(1)
  for (const p of players) {
    const after = moneyOf(p.player_id)
    await expect(playerRow(page, p.name)).toContainText(dollars(after))
    if (paid.some((x) => x.player_id === p.player_id)) {
      expect(after, `${p.name} holds the most ${defunct} and is paid`).toBeGreaterThan(p.cash)
    }
  }
  const unpaid = players.filter(
    (p) => !paid.some((x) => x.player_id === p.player_id) && (p.holdings[defunct] ?? 0) <= 1
  )
  for (const p of unpaid) expect(moneyOf(p.player_id)).toBe(p.cash)

  // The browser player's own header agrees with the server.
  expect(money(await page.getByTestId('header-cash').innerText())).toBe(moneyOf(human.player_id))
  await shots.take(page, 'payout-shown')
})
