import { test, expect } from './support/test'
import { startFromSnapshot } from './support/room'
import {
  boardTile,
  phaseBanner,
  playHumanTurns,
  rack,
  rackTile,
  waitForMyDecision,
} from './support/ui'

// What a player sees change across a plain turn: the bag and rack, the board colours and the
// chain sizes. (The rules behind them are tier-1 tests; this checks the screen follows.)

test('opening turn: no chains to buy, END GAME not offered, hand refills and the bag shrinks', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'opening-place-tile')
  const { human, tiles_remaining: bagBefore } = room.fixture.expect
  await shots.take(page, 'loaded')

  // The game cannot be ended this early: no END GAME control while placing a tile.
  await expect(page.getByTestId('end-game-button')).toHaveCount(0)
  await expect(rack(page).locator('[data-testid^="tile-"]')).toHaveCount(human.hand.length)
  await expect(page.getByTestId('header-tile-pool')).toHaveText(`[${bagBefore}]`)

  // Place a tile that just sits on the board: the buy phase has no chain to offer.
  const tiles = room.fixture.expect.decisions[0].legal.tiles as Array<{
    tile: string
    outcome: string
  }>
  const tile = tiles.find((t) => t.outcome === 'nothing')!.tile
  await rackTile(page, tile).click()
  await page.getByTestId('place-tile-button').click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(page.getByText('No active hotel chains to buy into')).toBeVisible()
  await expect(page.locator('[data-testid^="buy-row-"]')).toHaveCount(0)
  await expect(page.getByTestId('end-turn-button')).toHaveText('SKIP & END TURN')
  await expect(page.getByTestId('end-game-button')).toHaveCount(0)
  await shots.take(page, 'buy-phase-no-chains')

  // End the turn; once it is my turn again the rack is full (6) and the bag is smaller.
  await page.getByTestId('end-turn-button').click()
  await waitForMyDecision(page, room)
  await expect(rack(page).locator('[data-testid^="tile-"]')).toHaveCount(human.hand.length)
  await expect(rackTile(page, tile)).toHaveCount(0)
  // The tile I placed is on the board as a lone tile (not part of any chain).
  await expect(boardTile(page, tile)).toHaveAttribute('data-chain', 'orphan')
  const bagText = (await page.getByTestId('header-tile-pool').innerText()).replace(/[^0-9]/g, '')
  expect(Number(bagText)).toBeLessThan(bagBefore)
  await shots.take(page, 'next-turn-refilled')
})

test('expanding a chain: the new tile takes the chain colour and the chain size follows the board', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'three-player-midgame')
  const { active_chains } = room.fixture.expect
  const tiles = room.fixture.expect.decisions[0].legal.tiles as Array<{
    tile: string
    outcome: string
    chains: string[]
  }>
  const grow = tiles.find((t) => t.outcome === 'expand' && t.chains.length === 1)!
  const chain = grow.chains[0]
  const key = chain.toLowerCase()
  await shots.take(page, 'loaded')

  // The board (shown while placing a tile or waiting) colours exactly the chain's tiles.
  const onBoard = page.getByTestId('board').locator(`[data-testid^="tile-"][data-chain="${chain}"]`)
  await expect(onBoard).toHaveCount(active_chains[chain].size)

  await rackTile(page, grow.tile).click()
  await page.getByTestId('place-tile-button').click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  // The placed square belongs to the chain; the buy list and the board agree on the new size,
  // which is larger than before (lone tiles next to the new one are absorbed as well).
  const sizeText = await page.getByTestId(`buy-row-${key}`).getByTestId('buy-size').innerText()
  const grown = Number(sizeText.replace(/[^0-9]/g, ''))
  expect(grown).toBeGreaterThan(active_chains[chain].size)
  await shots.take(page, 'chain-grown')

  // Back on the board screen: the new tile is part of the chain and the board has at least as
  // many squares in the chain's colour as the buy list said (opponents may have added more).
  await page.getByTestId('end-turn-button').click()
  await waitForMyDecision(page, room)
  await expect(boardTile(page, grow.tile)).toHaveAttribute('data-chain', chain)
  expect(await onBoard.count()).toBeGreaterThanOrEqual(grown)
  await shots.take(page, 'chain-on-board')
  await playHumanTurns(page, room, 2, shots)
})
