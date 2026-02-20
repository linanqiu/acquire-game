import { test, expect } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import { createGameViaUI, addBotViaUI, startGameViaUI } from './helpers/game-setup'
import {
  selectTileFromRack,
  placeTile,
  endTurn,
  hasChainSelector,
  selectFirstAvailableChain,
  getPhaseText,
  setupConsoleErrorTracking,
  waitForWebSocketConnected,
  waitForPhaseChange,
  isInBuyPhase,
  safeEndTurnInBuyPhase,
  sendActionViaHttp,
} from './helpers/turn-actions'
import { hasDispositionUI, confirmDisposition } from './helpers/merger'

const CATEGORY = 'end-game'

/**
 * End Game Scenarios (7.x)
 *
 * These tests verify end game mechanics in Acquire:
 * - Voluntary end game declaration when conditions are met (via UI button)
 * - Cannot end game prematurely (button not visible)
 * - Game over screen with winner, rankings, breakdown
 * - New game / back to lobby navigation
 *
 * Uses the default Playwright-managed backend with ACQUIRE_GAME_SEED=2.
 *
 * The backend sends `end_game_available: true` in the game_state WS message
 * when end conditions are met and it's the player's turn. The frontend renders
 * an "END GAME" button (data-testid="end-game-button") in the buy phase.
 */
test.describe('End Game Scenarios (7.x)', () => {
  test.beforeEach(() => {
    resetStepCounter()
  })

  /**
   * Handle the merger survivor chain choice UI if visible.
   */
  async function handleMergerChoice(
    page: import('@playwright/test').Page,
    label: string
  ): Promise<boolean> {
    const selector = page.getByTestId('chain-selector')
    const selectorVisible = await selector.isVisible().catch(() => false)
    if (!selectorVisible) return false

    const availableButtons = selector.locator('button:not([disabled])')
    const count = await availableButtons.count().catch(() => 0)
    if (count > 0) {
      const firstChain = availableButtons.first()
      const chainText = await firstChain.textContent()
      console.log(`  [${label}] Selecting merger survivor: "${chainText}"`)
      await firstChain.click()
      await page.waitForTimeout(500)
      return true
    }

    return false
  }

  /**
   * Handle any pending merger interactions: chain choice, disposition, or
   * stuck merger states. Returns true if something was handled.
   */
  async function handlePendingMergerAction(
    page: import('@playwright/test').Page,
    label: string
  ): Promise<boolean> {
    if (await handleMergerChoice(page, label)) return true

    if (await hasDispositionUI(page)) {
      await confirmDisposition(page)
      console.log(`  [${label}] Confirmed disposition via UI`)
      return true
    }

    const phase = await getPhaseText(page)
    if (phase.includes('DISPOSE') || phase.includes('MERGER') || phase.includes('SURVIVING')) {
      await page.waitForTimeout(1000)

      if (await handleMergerChoice(page, label)) return true
      if (await hasDispositionUI(page)) {
        await confirmDisposition(page)
        console.log(`  [${label}] Confirmed disposition via UI (after wait)`)
        return true
      }

      console.log(`  [${label}] Merger stuck (phase="${phase}"), reloading...`)
      await page.reload({ waitUntil: 'networkidle' })
      await waitForWebSocketConnected(page, 5000)
      await page.waitForTimeout(1000)

      if (await handleMergerChoice(page, label)) return true
      if (await hasDispositionUI(page)) {
        await confirmDisposition(page)
        console.log(`  [${label}] Confirmed disposition via UI (after reload)`)
        return true
      }
    }

    return false
  }

  /**
   * Wait for a merger to resolve, handling chain choices and disposition UIs.
   */
  async function waitForMergerResolution(
    page: import('@playwright/test').Page,
    turnNum: number,
    testName: string,
    timeout = 30000
  ): Promise<void> {
    console.log(`  [Turn ${turnNum}] Merger/disposition in progress`)
    await captureStep(page, `turn-${turnNum}-merger`, {
      category: CATEGORY,
      testName,
    })

    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      await handlePendingMergerAction(page, `Turn ${turnNum}`)

      const currentPhase = await getPhaseText(page)
      if (
        currentPhase.includes('BUY') ||
        currentPhase.includes('PLACE') ||
        currentPhase.includes("'s TURN") ||
        currentPhase.includes('GAME OVER')
      ) {
        break
      }
      await waitForPhaseChange(page, currentPhase, 3000)
    }
  }

  /**
   * End the turn and wait for phase to change from BUY STOCKS.
   * Uses shared helper with UI button + HTTP fallback.
   */
  async function endTurnAndWait(
    page: import('@playwright/test').Page,
    turnNum: number
  ): Promise<void> {
    const ended = await safeEndTurnInBuyPhase(page, `Turn ${turnNum}`)
    if (!ended) {
      if (await handlePendingMergerAction(page, `Turn ${turnNum}`)) {
        return
      }
      console.log(`  [Turn ${turnNum}] endTurn stuck after all attempts`)
    }
  }

  /**
   * Check if the END GAME button is visible in the UI.
   */
  async function isEndGameButtonVisible(
    page: import('@playwright/test').Page
  ): Promise<boolean> {
    return await page.getByTestId('end-game-button').isVisible().catch(() => false)
  }

  /**
   * Click the END GAME button and wait for game over.
   * Returns true if game ended successfully.
   */
  async function clickEndGameButton(
    page: import('@playwright/test').Page,
    label: string
  ): Promise<boolean> {
    const button = page.getByTestId('end-game-button')
    const visible = await button.isVisible().catch(() => false)
    if (!visible) return false

    console.log(`  [${label}] Clicking END GAME button...`)
    await button.click()

    // Wait for GAME OVER to appear
    try {
      await expect(
        page.getByTestId('game-phase')
      ).toContainText('GAME OVER', { timeout: 10000 })
      console.log(`  [${label}] *** GAME ENDED via END GAME button ***`)
      return true
    } catch {
      // UI didn't update - reload to pick up new state
      console.log(`  [${label}] UI didn't update after click, reloading...`)
      await page.reload({ waitUntil: 'networkidle' })
      await waitForWebSocketConnected(page, 10000)
      try {
        await expect(
          page.getByTestId('game-phase')
        ).toContainText('GAME OVER', { timeout: 10000 })
        console.log(`  [${label}] *** GAME ENDED (after reload) ***`)
        return true
      } catch {
        const uiPhase = await getPhaseText(page)
        console.log(`  [${label}] Still not GAME OVER after reload: "${uiPhase}"`)
        return uiPhase.includes('GAME OVER')
      }
    }
  }

  /**
   * Complete a single turn: place tile, handle founding/mergers, end turn.
   * If END GAME button is visible during buy phase, clicks it.
   */
  async function completeTurn(
    page: import('@playwright/test').Page,
    turnNum: number,
    testName: string,
    options: { skipEndTurn?: boolean; tryDeclareEnd?: boolean } = {}
  ): Promise<{ tilePlaced: string; chainFounded?: string; gameOver: boolean }> {
    const result: {
      tilePlaced: string
      chainFounded?: string
      gameOver: boolean
    } = {
      tilePlaced: '',
      gameOver: false,
    }

    // Try placing tiles from the rack - some may be unplayable
    let httpResult: { ok: boolean; phase?: string; error?: string } | null = null
    const rack = page.getByTestId('tile-rack')
    const tileButtons = rack.locator('[role="button"]')
    const tileCount = await tileButtons.count()

    for (let i = 0; i < tileCount; i++) {
      const tile = tileButtons.nth(i)
      const testId = await tile.getAttribute('data-testid')
      const coordinate = testId?.replace('tile-', '') || ''
      if (!coordinate) continue

      // Click the tile to select it
      await tile.click()
      result.tilePlaced = coordinate

      // Try placing via HTTP
      httpResult = await sendActionViaHttp(page, {
        action: 'place_tile',
        tile: coordinate,
      })

      if (httpResult?.ok) {
        console.log(`  [Turn ${turnNum}] Placed tile: ${coordinate} (server phase: "${httpResult.phase}")`)
        break
      }

      console.log(`  [Turn ${turnNum}] Tile ${coordinate} unplayable: ${httpResult?.error}`)
      httpResult = null
    }

    if (!httpResult?.ok) {
      console.log(`  [Turn ${turnNum}] No playable tiles in rack!`)
      return result
    }

    const serverPhase = httpResult?.phase || ''

    // Wait briefly for WS to deliver state update
    await page.waitForTimeout(500)

    // Check for game over
    let uiPhase = await getPhaseText(page)
    if (uiPhase.includes('GAME OVER') || serverPhase === 'game_over') {
      result.gameOver = true
      return result
    }

    // Handle chain founding
    if (serverPhase === 'found_chain') {
      if (await hasChainSelector(page)) {
        result.chainFounded = await selectFirstAvailableChain(page)
        console.log(`  [Turn ${turnNum}] Founded chain: ${result.chainFounded}`)
        await page.waitForTimeout(500)
      } else {
        console.log(`  [Turn ${turnNum}] Server at found_chain, reloading to sync UI`)
        await page.reload({ waitUntil: 'networkidle' })
        await waitForWebSocketConnected(page, 5000)
        if (await hasChainSelector(page)) {
          result.chainFounded = await selectFirstAvailableChain(page)
          console.log(`  [Turn ${turnNum}] Founded chain after reload: ${result.chainFounded}`)
          await page.waitForTimeout(500)
        }
      }
    }

    // Handle merger
    uiPhase = await getPhaseText(page)
    if (
      uiPhase.includes('DISPOSE') ||
      uiPhase.includes('MERGER') ||
      uiPhase.includes('SURVIVING') ||
      serverPhase === 'merger' ||
      serverPhase === 'merging'
    ) {
      await waitForMergerResolution(page, turnNum, testName)
    }

    // Check for game over after merger
    uiPhase = await getPhaseText(page)
    if (uiPhase.includes('GAME OVER')) {
      result.gameOver = true
      return result
    }

    // BUY phase - check for END GAME button or end turn
    if ((await isInBuyPhase(page)) || serverPhase === 'buy_stocks') {
      if (options.tryDeclareEnd) {
        // Check if END GAME button is visible (conditions met)
        if (await isEndGameButtonVisible(page)) {
          const ended = await clickEndGameButton(page, `Turn ${turnNum}`)
          if (ended) {
            result.gameOver = true
            return result
          }
        }
      }

      if (!options.skipEndTurn) {
        await endTurnAndWait(page, turnNum)
      }
    }

    return result
  }

  /**
   * Play the game loop, returning when game ends.
   * When the END GAME button appears, clicks it to declare end game.
   */
  async function playGameToCompletion(
    page: import('@playwright/test').Page,
    testName: string,
    maxTurns = 80
  ): Promise<{
    humanTurnCount: number
    totalTurnCount: number
    gameEnded: boolean
    endDeclaredViaButton: boolean
  }> {
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''
    let gameEnded = false
    let endDeclaredViaButton = false
    let consecutiveWaits = 0

    while (humanTurnCount < maxTurns && !gameEnded) {
      const phase = await getPhaseText(page)

      if (phase.includes('GAME OVER')) {
        gameEnded = true
        console.log(`\n*** GAME OVER detected at turn ${humanTurnCount} ***`)
        break
      }

      if (phase !== lastPhase) {
        if (phase.includes("'s TURN")) {
          totalTurnCount++
          if (totalTurnCount % 10 === 0) {
            console.log(`[Turn ${totalTurnCount}] ${phase}`)
          }
        }
        lastPhase = phase
        consecutiveWaits = 0
      }

      // Our turn to place a tile
      if (phase.includes('PLACE')) {
        humanTurnCount++
        totalTurnCount++

        if (humanTurnCount % 5 === 1) {
          console.log(
            `\n[Turn ${totalTurnCount}] === MY TURN #${humanTurnCount} ===`
          )
        }

        if (humanTurnCount % 10 === 1) {
          await captureStep(page, `turn-${humanTurnCount}-state`, {
            category: CATEGORY,
            testName,
          })
        }

        // Try clicking END GAME button during BUY phase if conditions are met
        const tryDeclareEnd = humanTurnCount >= 5

        const turnResult = await completeTurn(page, humanTurnCount, testName, {
          tryDeclareEnd,
        })

        if (turnResult.gameOver) {
          gameEnded = true
          if (tryDeclareEnd) endDeclaredViaButton = true
          break
        }

        lastPhase = ''
        consecutiveWaits = 0
      } else if (phase.includes('DISPOSE') || phase.includes('MERGER') || phase.includes('SURVIVING')) {
        await handlePendingMergerAction(page, 'Loop')
        const changed = await waitForPhaseChange(page, phase, 5000)
        if (changed) consecutiveWaits = 0
        else consecutiveWaits++
        if (consecutiveWaits > 15) {
          console.log(`  [Loop] Merger stuck, breaking`)
          break
        }
      } else if (phase.includes('BUY')) {
        // In BUY phase - check for END GAME button, then end turn
        if (humanTurnCount >= 5) {
          if (await isEndGameButtonVisible(page)) {
            const ended = await clickEndGameButton(page, 'Loop-BUY')
            if (ended) {
              gameEnded = true
              endDeclaredViaButton = true
              break
            }
          }
        }
        console.log(`  [Loop] In BUY phase, trying endTurn`)
        try {
          await endTurnAndWait(page, humanTurnCount)
          consecutiveWaits = 0
          lastPhase = ''
        } catch {
          consecutiveWaits++
          if (consecutiveWaits > 5) {
            console.log(`  [Loop] Can't unstick from BUY, breaking`)
            break
          }
        }
      } else {
        // Not our turn - check for disposition UI
        if (await handlePendingMergerAction(page, 'Loop-wait')) {
          consecutiveWaits = 0
          lastPhase = ''
          continue
        }

        const changed = await waitForPhaseChange(page, phase, 5000)
        if (!changed) {
          consecutiveWaits++
          if (await handlePendingMergerAction(page, 'Loop-wait-after')) {
            consecutiveWaits = 0
            lastPhase = ''
            continue
          }
          if (consecutiveWaits % 10 === 0 && consecutiveWaits > 0) {
            const probeResult = await sendActionViaHttp(page, {
              action: 'end_turn',
            })
            console.log(
              `  [Loop] HTTP probe: phase="${probeResult?.phase}", error="${probeResult?.error}"`
            )

            if (probeResult?.phase?.includes('game_over')) {
              await page.reload({ waitUntil: 'networkidle' })
              await waitForWebSocketConnected(page, 10000)
              gameEnded = true
              break
            }

            if (
              probeResult?.phase &&
              !phase.toLowerCase().includes(probeResult.phase.replace('_', ' '))
            ) {
              console.log(`  [Loop] Server phase mismatch, reloading...`)
              await page.reload({ waitUntil: 'networkidle' })
              await waitForWebSocketConnected(page, 10000)
              const refreshedPhase = await getPhaseText(page)
              console.log(`  [Loop] Phase after reload: "${refreshedPhase}"`)
              if (refreshedPhase.includes('GAME OVER')) {
                gameEnded = true
                break
              }
              if (await handlePendingMergerAction(page, 'Loop-reload')) {
                consecutiveWaits = 0
                lastPhase = ''
                continue
              }
              lastPhase = ''
              consecutiveWaits = 0
            }
          } else if (consecutiveWaits > 30) {
            const finalPhase = await getPhaseText(page)
            console.log(
              `  [Loop] Breaking after ${consecutiveWaits} waits. Final phase: "${finalPhase}"`
            )
            if (finalPhase.includes('GAME OVER')) {
              gameEnded = true
            }
            break
          }
        } else {
          consecutiveWaits = 0
        }
      }
    }

    return { humanTurnCount, totalTurnCount, gameEnded, endDeclaredViaButton }
  }

  test('7.3 & 7.15 & 7.13 & 7.16: Play to game end via UI button and verify game over screen', async ({
    page,
  }) => {
    test.setTimeout(600000) // 10 minutes

    const testName = '7.3-game-end-and-game-over'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots via UI
    await createGameViaUI(page, 'EndGamePlayer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await waitForWebSocketConnected(page)

    console.log('\n' + '='.repeat(60))
    console.log('END GAME TEST - Play full game to completion')
    console.log(
      'Strategy: Play turns, click END GAME button when it appears'
    )
    console.log('='.repeat(60))

    const { humanTurnCount, totalTurnCount, gameEnded, endDeclaredViaButton } =
      await playGameToCompletion(page, testName)

    await captureStep(page, 'game-end-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`GAME SUMMARY:`)
    console.log(`  Human turns: ${humanTurnCount}`)
    console.log(`  Total turns: ${totalTurnCount}`)
    console.log(`  Game ended: ${gameEnded}`)
    console.log(`  End declared via UI button: ${endDeclaredViaButton}`)
    console.log('='.repeat(60))

    // === VERIFY GAME OVER SCREEN ===
    expect(gameEnded).toBe(true)

    console.log('\n--- VERIFYING GAME OVER SCREEN ---')

    // 7.15: Verify game over container is visible
    const gameOverEl = page.getByTestId('game-over')
    await expect(gameOverEl).toBeVisible({ timeout: 10000 })
    console.log('  game-over container: VISIBLE')
    await captureStep(page, 'game-over-visible', {
      category: CATEGORY,
      testName,
    })

    // 7.13: Verify winner announcement
    const winnerAnnouncement = page.getByTestId('winner-announcement')
    await expect(winnerAnnouncement).toBeVisible()
    const winnerText = await winnerAnnouncement.textContent()
    console.log(`  Winner announcement: "${winnerText}"`)

    const hasWinner =
      winnerText?.includes('WINNER') || winnerText?.includes('TIE GAME')
    expect(hasWinner).toBe(true)
    await captureStep(page, 'winner-announcement', {
      category: CATEGORY,
      testName,
    })

    // 7.8: Verify rankings/scoring
    const rankings = page.getByTestId('rankings')
    await expect(rankings).toBeVisible()

    const rankRows = page.locator('[data-testid^="rank-"]')
    const rankCount = await rankRows.count()
    console.log(`  Number of ranked players: ${rankCount}`)
    expect(rankCount).toBeGreaterThanOrEqual(3) // 1 human + 2 bots

    // 7.11: Verify breakdown (cash + stock values)
    const breakdown = page.getByTestId('breakdown')
    await expect(breakdown).toBeVisible()
    const breakdownText = await breakdown.textContent()
    console.log(
      `  Breakdown content: "${breakdownText?.substring(0, 200)}"`
    )

    expect(breakdownText).toContain('Cash on hand')
    expect(breakdownText).toContain('Final bonuses')
    expect(breakdownText).toContain('Stock liquidation')
    expect(breakdownText).toContain('TOTAL')
    console.log('  Breakdown verified: cash, bonuses, stock liquidation, total')
    await captureStep(page, 'scoring-breakdown', {
      category: CATEGORY,
      testName,
    })

    // 7.16: Verify navigation buttons
    const playAgainButton = page.getByRole('button', { name: 'PLAY AGAIN' })
    await expect(playAgainButton).toBeVisible()

    const backToLobbyButton = page.getByRole('button', {
      name: 'BACK TO LOBBY',
    })
    await expect(backToLobbyButton).toBeVisible()
    console.log('  Navigation buttons: VISIBLE')
    await captureStep(page, 'navigation-buttons', {
      category: CATEGORY,
      testName,
    })

    // 7.16: Test navigation - click BACK TO LOBBY
    await backToLobbyButton.click()
    await expect(page).toHaveURL('/', { timeout: 10000 })
    console.log('  Navigated to lobby: OK')
    await captureStep(page, 'back-to-lobby', { category: CATEGORY, testName })

    const errors = errorTracker
      .getErrors()
      .filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('7.4: Cannot end game prematurely - END GAME button not visible', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    const testName = '7.4-no-premature-end'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots via UI
    await createGameViaUI(page, 'PrematureEnder')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await waitForWebSocketConnected(page)

    console.log('\n' + '='.repeat(60))
    console.log('PREMATURE END GAME TEST - Verify END GAME button not visible early')
    console.log('='.repeat(60))

    // Play 5 turns normally
    const SETUP_TURNS = 5
    let humanTurnCount = 0
    let lastPhase = ''
    let endGameButtonSeen = false

    while (humanTurnCount < SETUP_TURNS) {
      const phase = await getPhaseText(page)
      if (phase.includes('GAME OVER')) break

      if (phase !== lastPhase) lastPhase = phase

      if (phase.includes('PLACE')) {
        humanTurnCount++
        const turnResult = await completeTurn(
          page,
          humanTurnCount,
          testName,
          { skipEndTurn: true }
        )
        if (turnResult.gameOver) break

        // After placing tile, we should be in BUY phase
        // Check that the END GAME button is NOT visible
        if (await isInBuyPhase(page)) {
          const endGameVisible = await isEndGameButtonVisible(page)
          console.log(`  [Turn ${humanTurnCount}] END GAME button visible: ${endGameVisible}`)
          if (endGameVisible) {
            endGameButtonSeen = true
          }
          await captureStep(page, `turn-${humanTurnCount}-buy-phase`, {
            category: CATEGORY,
            testName,
          })

          // End the turn normally
          await endTurnAndWait(page, humanTurnCount)
        }

        lastPhase = ''
      } else {
        await waitForPhaseChange(page, phase, 5000)
      }
    }

    console.log(`  Played ${humanTurnCount} setup turns`)
    await captureStep(page, 'after-setup-turns', {
      category: CATEGORY,
      testName,
    })

    // Wait for one more turn and verify END GAME button not visible
    console.log('  Waiting for next turn to verify END GAME button absence...')
    let waited = 0
    while (waited < 30000) {
      const phase = await getPhaseText(page)
      if (phase.includes('PLACE')) break
      await waitForPhaseChange(page, phase, 3000)
      waited += 3000
    }

    // Place tile but don't end turn
    humanTurnCount++
    const turnResult = await completeTurn(
      page,
      humanTurnCount,
      testName,
      { skipEndTurn: true }
    )

    if (!turnResult.gameOver && (await isInBuyPhase(page))) {
      // Verify END GAME button is NOT visible (conditions not met this early)
      const endGameVisible = await isEndGameButtonVisible(page)
      console.log(`  [Turn ${humanTurnCount}] END GAME button visible: ${endGameVisible}`)
      await captureStep(page, 'end-game-button-check', {
        category: CATEGORY,
        testName,
      })

      // The button should not be visible since end conditions are not met early in the game
      expect(endGameVisible).toBe(false)
      console.log(`  *** CONFIRMED: END GAME button correctly hidden ***`)

      // End the turn normally
      await endTurn(page)
      console.log(`  Turn ended after verification`)
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(
      `SUMMARY: Played ${humanTurnCount} turns, END GAME button correctly not visible`
    )
    console.log(`  END GAME button ever seen: ${endGameButtonSeen}`)
    console.log('='.repeat(60))

    expect(humanTurnCount).toBeGreaterThanOrEqual(5)
    // The button should never have appeared in the first 6 turns
    expect(endGameButtonSeen).toBe(false)

    const errors = errorTracker
      .getErrors()
      .filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('7.8 & 7.11: Final scoring display with breakdown', async ({
    page,
  }) => {
    test.setTimeout(600000) // 10 minutes

    const testName = '7.8-scoring-display'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots via UI
    await createGameViaUI(page, 'ScoreChecker')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await waitForWebSocketConnected(page)

    console.log('\n' + '='.repeat(60))
    console.log('SCORING DISPLAY TEST - Play game and verify final scoring')
    console.log('='.repeat(60))

    const { humanTurnCount, totalTurnCount, gameEnded } =
      await playGameToCompletion(page, testName)

    await captureStep(page, 'game-end-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`Game ended: ${gameEnded}`)
    console.log(`Human turns: ${humanTurnCount}, Total turns: ${totalTurnCount}`)
    console.log('='.repeat(60))

    expect(gameEnded).toBe(true)

    console.log('\n--- VERIFYING SCORING DISPLAY ---')

    // Wait for game over screen
    const gameOverEl = page.getByTestId('game-over')
    await expect(gameOverEl).toBeVisible({ timeout: 10000 })
    await captureStep(page, 'game-over-screen', {
      category: CATEGORY,
      testName,
    })

    // Verify rankings section
    const rankings = page.getByTestId('rankings')
    await expect(rankings).toBeVisible()

    const rankRows = page.locator('[data-testid^="rank-"]')
    const rankCount = await rankRows.count()
    console.log(`  Rankings visible with ${rankCount} players`)

    for (let i = 0; i < rankCount; i++) {
      const row = rankRows.nth(i)
      const rowText = await row.textContent()
      console.log(`  Rank ${i + 1}: ${rowText}`)
    }

    // Verify all ranks show dollar amounts
    for (let i = 0; i < rankCount; i++) {
      const row = rankRows.nth(i)
      const text = await row.textContent()
      expect(text).toContain('$')
    }
    await captureStep(page, 'rankings-verified', {
      category: CATEGORY,
      testName,
    })

    // Verify breakdown section
    const breakdown = page.getByTestId('breakdown')
    await expect(breakdown).toBeVisible()
    const breakdownText = await breakdown.textContent()
    console.log(`  Breakdown text: "${breakdownText}"`)

    // Extract values from breakdown
    const cashMatch = breakdownText?.match(/Cash on hand:\s*\$([0-9,]+)/)
    const bonusMatch = breakdownText?.match(/Final bonuses:\s*\+\$([0-9,]+)/)
    const stockMatch = breakdownText?.match(
      /Stock liquidation:\s*\+\$([0-9,]+)/
    )
    const totalMatch = breakdownText?.match(/TOTAL:\s*\$([0-9,]+)/)

    if (cashMatch) console.log(`  Cash on hand: $${cashMatch[1]}`)
    if (bonusMatch) console.log(`  Final bonuses: +$${bonusMatch[1]}`)
    if (stockMatch) console.log(`  Stock liquidation: +$${stockMatch[1]}`)
    if (totalMatch) console.log(`  TOTAL: $${totalMatch[1]}`)

    // Verify total exists
    expect(totalMatch).not.toBeNull()

    await captureStep(page, 'breakdown-verified', {
      category: CATEGORY,
      testName,
    })

    // Verify winner announcement
    const winnerText = await page
      .getByTestId('winner-announcement')
      .textContent()
    console.log(`  Winner: "${winnerText}"`)
    const hasWinnerOrTie =
      winnerText?.includes('WINNER') || winnerText?.includes('TIE GAME')
    expect(hasWinnerOrTie).toBe(true)

    await captureStep(page, 'final-scoring-verified', {
      category: CATEGORY,
      testName,
    })

    const errors = errorTracker
      .getErrors()
      .filter((e) => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })
})
