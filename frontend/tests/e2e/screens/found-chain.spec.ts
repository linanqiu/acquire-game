import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { headerCash, phaseBanner, playHumanTurns } from './support/ui'

const ALL_CHAINS = ['sandpiper', 'marlowe', 'halcyon', 'meridian', 'juniper', 'obsidian', 'aurelia']

test('found chain: only the chains not on the board are offered; founder gets a free share', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'found-chain-choice')
  const { human, decisions, active_chains } = room.fixture.expect
  const offered = decisions[0].legal.chains as string[]
  await shots.take(page, 'chain-selector')

  await expect(phaseBanner(page)).toHaveText('CHOOSE A HOTEL CHAIN')
  await expect(page.getByText('Found a hotel chain')).toBeVisible()
  await expect(page.getByTestId('chain-selector')).toBeVisible()

  // Exactly the engine's available chains are enabled; everything else is shown as ACTIVE.
  for (const chain of ALL_CHAINS) {
    const button = page.getByTestId(`chain-button-${chain.toLowerCase()}`)
    if (offered.includes(chain)) {
      await expect(button).toBeEnabled()
      await expect(button).toContainText('shares left')
    } else {
      await expect(button).toBeDisabled()
      await expect(button).toContainText('ACTIVE')
      expect(Object.keys(active_chains)).toContain(chain)
    }
  }
  await expect(page.locator('[data-testid^="chain-button-"]:not([disabled])')).toHaveCount(
    offered.length
  )

  // Choose one; the founder's free share lands in the portfolio and the buy phase follows.
  const chosen = offered[1]
  const before = human.holdings[chosen] ?? 0
  await expect(page.getByTestId(`portfolio-row-${chosen.toLowerCase()}`)).toHaveCount(before)
  await page.getByTestId(`chain-button-${chosen.toLowerCase()}`).click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  const row = page.getByTestId(`portfolio-row-${chosen.toLowerCase()}`)
  await expect(row).toContainText(String(before + 1))
  await expect(page.getByTestId(`buy-row-${chosen.toLowerCase()}`)).toBeVisible()
  // The founder's share is free: cash unchanged.
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
  await shots.take(page, 'founded-buy-phase')

  // Finish this turn and play two more.
  await playHumanTurns(page, room, 3, shots)
})
