/**
 * Tier 3: the merger-order choice on a phone (390x675).
 *
 * The human placed a tile that merges three chains; the two defunct chains are the same size,
 * so the human picks which is absorbed first. The panel (under the board) offers exactly the
 * tied chains, one tappable row each with size, price, bonuses and holders; tapping a row
 * answers, and the merger goes on with that chain.
 *
 * Setup (tier 3 only): generated snapshot `merger-order-tie`, scripted opponents.
 */
import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import { dollars } from './support/fixtures'
import { outsideWidth } from './support/layout'
import { phaseBanner, playHumanTurns } from './support/ui'

const PHONE = { width: 390, height: 675 }

test('merger order: the human picks which same-size chain is absorbed first', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'merger-order-tie', { viewport: PHONE })
  const { decisions, active_chains, human, chain_holders } = room.fixture.expect
  const d = decisions[0]
  expect(d.kind).toBe('choose_defunct_order')
  const tied = d.legal.chains as string[]
  expect(tied.length).toBeGreaterThanOrEqual(2)
  console.log(`[order] tied defunct chains: ${tied.join(', ')}`)

  const panel = page.getByTestId('merger-order')
  await expect(panel).toBeVisible()
  await expect(phaseBanner(page)).toHaveText('CHOOSE THE MERGER ORDER')
  await expect(page.getByTestId('merger-order-title')).toHaveText(
    'Which hotel chain is absorbed first?'
  )
  await shots.take(page, 'order-choice')

  // Exactly the tied chains are offered, each with the engine's numbers and its holders.
  await expect(panel.getByRole('button')).toHaveCount(tied.length)
  const holders = chain_holders as unknown as Record<
    string,
    {
      majority_bonus: number
      minority_bonus: number
      holders: Array<{ player_id: string; shares: number }>
    }
  >
  for (const chain of tied) {
    const row = page.getByTestId(`merger-order-${chain}`)
    await expect(row).toBeEnabled()
    await expect(page.getByTestId(`merger-order-facts-${chain}`)).toHaveText(
      `${active_chains[chain].size} tiles · ${dollars(active_chains[chain].price)}`
    )
    await expect(page.getByTestId(`merger-order-bonus-${chain}`)).toHaveText(
      `1st ${dollars(holders[chain].majority_bonus)} · 2nd ${dollars(holders[chain].minority_bonus)}`
    )
    const held = holders[chain].holders.filter((h) => h.shares > 0)
    expect(held.length).toBeGreaterThan(0)
    await expect(row.locator('[data-shares]')).toHaveCount(
      held.length + (held.some((h) => h.player_id === human.player_id) ? 0 : 1)
    )
    // A row is a comfortable tap target and stays inside the phone's width.
    const box = (await row.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width)
  }
  expect(await outsideWidth(page, '[data-testid="merger-order"] *')).toEqual([])

  // Tap the second chain: it is absorbed first, and the human (who holds it) is asked about it.
  const first = tied[1]
  console.log(`[order] choosing ${first} first`)
  expect(human.holdings[first] ?? 0).toBeGreaterThan(0)
  await page.getByTestId(`merger-order-${first}`).click()
  await expect(panel).toBeHidden()
  await expect(phaseBanner(page)).toHaveText('DISPOSE YOUR SHARES')
  await expect(page.getByTestId('merger-disposition')).toHaveAttribute('data-defunct', first)
  await shots.take(page, 'first-chain-disposition')
  await page.getByTestId('confirm-disposition').click()

  // The scripted holders answer; then the other chain comes, without a second question.
  const second = tied[0]
  expect(human.holdings[second] ?? 0).toBeGreaterThan(0)
  await expect(page.getByTestId('merger-disposition')).toHaveAttribute('data-defunct', second)
  await expect(panel).toBeHidden()
  await shots.take(page, 'second-chain-disposition')
  await page.getByTestId('confirm-disposition').click()

  // The merger finishes; carry on with real turns.
  await playHumanTurns(page, room, 2, shots)
})
