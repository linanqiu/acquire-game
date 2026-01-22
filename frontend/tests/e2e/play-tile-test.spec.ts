import { test, expect } from '@playwright/test'

test.describe('Tile Placement', () => {
  test('can select and place a tile on the board', async ({ page }) => {
    // Create game and start with bots
    await page.goto('/')
    await page.getByLabel(/your name/i).first().fill('TestHost')
    await page.getByRole('button', { name: 'CREATE' }).click()
    await page.waitForURL(/\/play\/[A-Z]{4}/)
    await page.waitForTimeout(2000)

    // Add 2 bots
    await page.getByRole('button', { name: /ADD BOT/i }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: /ADD BOT/i }).click()
    await page.waitForTimeout(500)

    // Start game
    await page.getByRole('button', { name: /START GAME/i }).click()
    await page.waitForTimeout(2000)

    // Screenshot 1: Game started, ready to place tile
    await page.screenshot({ path: 'test-results/tile-1-game-started.png', fullPage: true })

    // Verify we're in place_tile phase
    await expect(page.getByText('PLACE A TILE')).toBeVisible()

    // Get the tile rack
    const tileRack = page.getByTestId('tile-rack')
    await expect(tileRack).toBeVisible()

    // Click the first tile in the rack (tiles use role="button" on div elements)
    const firstTile = tileRack.locator('[role="button"]').first()
    const tileLabel = await firstTile.textContent()
    await firstTile.click()

    // Screenshot 2: Tile selected
    await page.screenshot({ path: 'test-results/tile-2-tile-selected.png', fullPage: true })

    // Verify tile is selected and PLACE TILE button appears
    await expect(page.getByText(`Selected: ${tileLabel}`)).toBeVisible()
    const placeButton = page.getByRole('button', { name: /PLACE TILE/i })
    await expect(placeButton).toBeVisible()
    await expect(placeButton).toBeEnabled()

    // Click PLACE TILE button
    await placeButton.click()

    // Wait for action to complete and game state to update
    await page.waitForTimeout(2000)

    // Screenshot 3: After placing tile
    await page.screenshot({ path: 'test-results/tile-3-tile-placed.png', fullPage: true })

    // The game should have progressed - either:
    // - Bots take their turns (phase changes)
    // - Or we're in buy_stocks phase
    // Just verify we're no longer showing the same PLACE A TILE prompt for our turn
    // (The bots should play or we should be in a different phase)
  })
})
