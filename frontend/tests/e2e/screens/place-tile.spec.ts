import { test, expect } from './support/test'
import { startFromSnapshot, type RoomContext } from './support/room'
import { dollars } from './support/fixtures'
import {
  boardTile,
  clickableRackTiles,
  headerCash,
  phaseBanner,
  playHumanTurns,
  playerRows,
  rack,
  rackTile,
} from './support/ui'
import type { Page } from '@playwright/test'
import type { Shots } from './support/test'

/** Copy shown under the rack for each engine reason code. */
const REASON_TEXT: Record<string, RegExp> = {
  would_merge_safe_chains: /merge two hotel chains that are safe/i,
  would_create_eighth_chain: /8th hotel chain/i,
}

async function expectRackMatchesFixture(page: Page, room: RoomContext) {
  const { human } = room.fixture.expect
  await expect(phaseBanner(page)).toHaveText('PLACE A TILE')
  await expect(headerCash(page)).toHaveText(dollars(human.cash))
  await expect(rack(page).locator('[data-testid^="tile-"]')).toHaveCount(human.hand.length)
  for (const t of human.hand) await expect(rackTile(page, t)).toBeVisible()
  const blocked = Object.keys(human.unplayable_tiles)
  await expect(clickableRackTiles(page)).toHaveCount(human.hand.length - blocked.length)
  for (const t of human.hand) {
    if (blocked.includes(t)) {
      // Visually distinct (lock or cross) and not an interactive control.
      await expect(rackTile(page, t)).not.toHaveAttribute('role', 'button')
      await expect(rackTile(page, t)).toContainText(/🔒|✕/)
      await expect(page.getByTestId(`rack-note-${t}`)).toContainText(
        REASON_TEXT[human.unplayable_tiles[t]]
      )
    } else {
      await expect(rackTile(page, t)).toHaveAttribute('role', 'button')
      await expect(rackTile(page, t)).not.toContainText(/🔒|✕/)
      await expect(page.getByTestId(`rack-note-${t}`)).toHaveCount(0)
    }
  }
  // Holdings in the portfolio and the players panel.
  for (const [chain, qty] of Object.entries(human.holdings)) {
    if (qty > 0) {
      await expect(page.getByTestId(`portfolio-row-${chain.toLowerCase()}`)).toContainText(
        String(qty)
      )
    }
  }
}

/** First playable tile from the engine's legal list that just sits on the board or grows a chain. */
function pickSimpleTile(room: RoomContext): string {
  const tiles = (room.fixture.expect.decisions[0].legal.tiles ?? []) as Array<{
    tile: string
    outcome: string
  }>
  return (tiles.find((t) => t.outcome === 'nothing') ?? tiles.find((t) => t.outcome === 'expand')!)
    .tile
}

async function placeThenKeepPlaying(page: Page, room: RoomContext, shots: Shots, tile: string) {
  await rackTile(page, tile).click()
  await shots.take(page, 'tile-selected')
  await expect(page.getByTestId('place-tile-button')).toBeVisible()
  await page.getByTestId('place-tile-button').click()
  await expect(phaseBanner(page)).toHaveText('BUY STOCKS')
  await expect(rackTile(page, tile)).toHaveCount(0)
  await shots.take(page, 'tile-placed-buy-phase')
  // Finish this turn, then two more full turns against the scripted opponents.
  await playHumanTurns(page, room, 3, shots)
  await shots.take(page, 'after-more-turns')
}

test('opening: empty board, six playable tiles, place one', async ({ page, shots }) => {
  const room = await startFromSnapshot(page, 'opening-place-tile')
  const { players } = room.fixture.expect
  await shots.take(page, 'loaded')

  await expectRackMatchesFixture(page, room)
  await expect(playerRows(page)).toHaveCount(players.length)
  for (const p of players) {
    await expect(playerRows(page).filter({ hasText: p.name })).toContainText(dollars(p.cash))
  }
  await expect(page.getByTestId('portfolio-empty')).toBeVisible()
  await expect(page.getByTestId('header-tile-pool')).toHaveText(
    `[${room.fixture.expect.tiles_remaining}]`
  )
  // Place button only appears once a tile is selected.
  await expect(page.getByTestId('place-tile-button')).toHaveCount(0)

  await placeThenKeepPlaying(page, room, shots, pickSimpleTile(room))
})

test('safe chain on board: tile that would merge two safe chains cannot be placed', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'safe-chain-on-board')
  await shots.take(page, 'loaded')
  await expectRackMatchesFixture(page, room)

  // The safe chain is visible with its safe size in the board's chain tiles; try the dead tile.
  const [blockedTile] = Object.keys(room.fixture.expect.human.unplayable_tiles)
  await rackTile(page, blockedTile).click({ force: true })
  await expect(page.getByTestId('place-tile-button')).toHaveCount(0)
  // Clicking its square on the board must not select it either.
  await boardTile(page, blockedTile).click({ force: true })
  await expect(page.getByTestId('place-tile-button')).toHaveCount(0)
  await shots.take(page, 'blocked-tile-cannot-be-selected')

  await placeThenKeepPlaying(page, room, shots, pickSimpleTile(room))
})

test('dead tile in hand: a tile that would start an 8th chain is marked and cannot be placed', async ({
  page,
  shots,
}) => {
  const room = await startFromSnapshot(page, 'dead-tile-in-hand')
  await shots.take(page, 'loaded')
  await expectRackMatchesFixture(page, room)

  const [deadTile] = Object.keys(room.fixture.expect.human.unplayable_tiles)
  await rackTile(page, deadTile).click({ force: true })
  await expect(page.getByTestId('place-tile-button')).toHaveCount(0)
  await boardTile(page, deadTile).click({ force: true })
  await expect(page.getByTestId('place-tile-button')).toHaveCount(0)
  await shots.take(page, 'dead-tile-cannot-be-selected')

  await placeThenKeepPlaying(page, room, shots, pickSimpleTile(room))
})
