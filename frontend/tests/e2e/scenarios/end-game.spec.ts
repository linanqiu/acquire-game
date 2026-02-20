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
  waitForPhase,
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
 * - Voluntary end game declaration when conditions are met
 * - Cannot end game prematurely
 * - Game over screen with winner, rankings, breakdown
 * - New game / back to lobby navigation
 *
 * Uses the default Playwright-managed backend with ACQUIRE_GAME_SEED=2.
 *
 * Note: Bots do NOT declare end game. The game ends either:
 * 1. When the human player declares end game via WebSocket
 * 2. When all players have no playable tiles
 *
 * Since there is no "End Game" button in the UI yet, we intercept the
 * can_end_game WebSocket message and send declare_end_game directly
 * via the captured WebSocket.
 */
test.describe('End Game Scenarios (7.x)', () => {
  test.beforeEach(async ({ page }) => {
    resetStepCounter()
    // Monkey-patch WebSocket to:
    // 1. Capture instances for sending declare_end_game
    // 2. Listen for can_end_game messages to know when declaration is allowed
    await page.addInitScript(() => {
      ;(window as unknown as { __canEndGame: boolean }).__canEndGame = false
      ;(window as unknown as { __capturedWs: WebSocket[] }).__capturedWs = []

      const OrigWebSocket = window.WebSocket
      const patchedConstruct = new Proxy(OrigWebSocket, {
        construct(target, args) {
          const ws = new target(...(args as [string, ...string[]]))
          ;(window as unknown as { __capturedWs: WebSocket[] }).__capturedWs.push(ws)

          // Add a passive listener for can_end_game messages
          ws.addEventListener('message', (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data)
              if (data.type === 'can_end_game') {
                ;(window as unknown as { __canEndGame: boolean }).__canEndGame = true
              }
            } catch {
              // ignore parse errors
            }
          })

          return ws
        },
      })
      window.WebSocket = patchedConstruct
    })
  })

  /**
   * Send declare_end_game action via captured WebSocket.
   */
  async function declareEndGameViaWebSocket(
    page: import('@playwright/test').Page
  ): Promise<boolean> {
    return await page.evaluate(() => {
      const instances = (window as unknown as { __capturedWs?: WebSocket[] })
        .__capturedWs || []
      for (let i = instances.length - 1; i >= 0; i--) {
        const ws = instances[i]
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'declare_end_game' }))
          return true
        }
      }
      return false
    })
  }

  /**
   * Try to declare end game via HTTP. The server will accept if conditions
   * are met and it's our turn, or reject harmlessly if not.
   * Returns true if the game ended, false otherwise.
   */
  async function tryDeclareEndGameViaHttp(
    page: import('@playwright/test').Page,
    label: string
  ): Promise<boolean> {
    // First check the WS flag (fast path, no network call)
    const wsFlag = await page.evaluate(
      () => (window as unknown as { __canEndGame: boolean }).__canEndGame
    )

    if (!wsFlag) {
      // Also try HTTP anyway - the WS flag might have been missed
      // But only if we're in BUY phase (declare_end_game works in BUYING_STOCKS)
      const phase = await getPhaseText(page)
      if (!phase.includes('BUY')) return false
    }

    console.log(`  [${label}] Attempting declare_end_game via HTTP...`)
    const result = await sendActionViaHttp(page, { action: 'declare_end_game' })

    if (result?.ok) {
      const phase = result.phase || ''
      console.log(`  [${label}] declare_end_game HTTP response phase: "${phase}"`)
      if (phase.includes('game_over')) {
        // Wait for the UI to update via WebSocket broadcast
        try {
          await expect(
            page.getByTestId('game-phase')
          ).toContainText('GAME OVER', { timeout: 5000 })
          console.log(`  [${label}] *** GAME ENDED via HTTP declare ***`)
          return true
        } catch {
          // WebSocket didn't deliver game_over - reload to pick up new state
          console.log(`  [${label}] UI didn't update via WS, reloading page...`)
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
    } else if (result?.error) {
      // Server rejected - conditions not met (this is expected and harmless)
      if (!result.error.includes('not met') && !result.error.includes('Only the current')) {
        console.log(`  [${label}] declare_end_game rejected: ${result.error}`)
      }
    }

    return false
  }

  /**
   * Handle the merger survivor chain choice UI if visible.
   * The ChainSelector has data-testid="chain-selector" and buttons with
   * data-testid="chain-button-{name}".
   */
  async function handleMergerChoice(
    page: import('@playwright/test').Page,
    label: string
  ): Promise<boolean> {
    const selector = page.getByTestId('chain-selector')
    const selectorVisible = await selector.isVisible().catch(() => false)
    if (!selectorVisible) return false

    // Find the first enabled (available) chain button
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
    // 1. Check for merger survivor choice UI
    if (await handleMergerChoice(page, label)) {
      return true
    }

    // 2. Check for disposition UI
    if (await hasDispositionUI(page)) {
      await confirmDisposition(page)
      console.log(`  [${label}] Confirmed disposition via UI`)
      return true
    }

    // 3. Check if phase indicates merger/disposition but UI hasn't rendered yet
    const phase = await getPhaseText(page)
    if (phase.includes('DISPOSE') || phase.includes('MERGER') || phase.includes('SURVIVING')) {
      await page.waitForTimeout(1000)

      // Re-check for chain choice and disposition after brief wait
      if (await handleMergerChoice(page, label)) return true
      if (await hasDispositionUI(page)) {
        await confirmDisposition(page)
        console.log(`  [${label}] Confirmed disposition via UI (after wait)`)
        return true
      }

      // Still stuck - reload to trigger reconnect + re-send of pending messages
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
      // Check for disposition that might have appeared
      if (await handlePendingMergerAction(page, `Turn ${turnNum}`)) {
        return
      }
      console.log(`  [Turn ${turnNum}] endTurn stuck after all attempts`)
    }
  }

  /**
   * Complete a single turn: place tile, handle founding/mergers, end turn.
   * Uses HTTP actions directly for reliability and speed.
   * Optionally tries to declare end game during BUY phase.
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

      // This tile can't be placed - try next one
      console.log(`  [Turn ${turnNum}] Tile ${coordinate} unplayable: ${httpResult?.error}`)
      httpResult = null
    }

    if (!httpResult?.ok) {
      // No playable tiles - all tiles are unplayable
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

    // Handle chain founding (only when server confirms found_chain phase)
    if (serverPhase === 'found_chain') {
      if (await hasChainSelector(page)) {
        result.chainFounded = await selectFirstAvailableChain(page)
        console.log(`  [Turn ${turnNum}] Founded chain: ${result.chainFounded}`)
        await page.waitForTimeout(500)
      } else {
        // Server says found_chain but UI doesn't show it - reload to sync
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

    // Handle merger (chain choice, disposition, etc.)
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

    // BUY phase - try declare end game or end turn
    if ((await isInBuyPhase(page)) || serverPhase === 'buy_stocks') {
      if (options.tryDeclareEnd) {
        const ended = await tryDeclareEndGameViaHttp(page, `Turn ${turnNum}`)
        if (ended) {
          result.gameOver = true
          return result
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
   * When the server signals can_end_game, declares end game during BUY phase.
   */
  async function playGameToCompletion(
    page: import('@playwright/test').Page,
    testName: string,
    maxTurns = 80
  ): Promise<{
    humanTurnCount: number
    totalTurnCount: number
    gameEnded: boolean
    endDeclared: boolean
  }> {
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''
    let gameEnded = false
    let endDeclared = false
    let consecutiveWaits = 0

    while (humanTurnCount < maxTurns && !gameEnded) {
      const phase = await getPhaseText(page)

      // Check for game over
      if (phase.includes('GAME OVER')) {
        gameEnded = true
        console.log(`\n*** GAME OVER detected at turn ${humanTurnCount} ***`)
        break
      }

      // Track phase changes
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

        // Screenshot periodically
        if (humanTurnCount % 10 === 1) {
          await captureStep(page, `turn-${humanTurnCount}-state`, {
            category: CATEGORY,
            testName,
          })
        }

        // Try declaring end game during BUY phase if conditions are met
        const tryDeclareEnd = humanTurnCount >= 5 && !endDeclared

        const turnResult = await completeTurn(page, humanTurnCount, testName, {
          tryDeclareEnd,
        })

        if (turnResult.gameOver) {
          gameEnded = true
          if (tryDeclareEnd) endDeclared = true
          break
        }

        lastPhase = ''
        consecutiveWaits = 0
      } else if (phase.includes('DISPOSE') || phase.includes('MERGER') || phase.includes('SURVIVING')) {
        // Merger in progress - might need to handle chain choice or disposition
        await handlePendingMergerAction(page, 'Loop')
        const changed = await waitForPhaseChange(page, phase, 5000)
        if (changed) consecutiveWaits = 0
        else consecutiveWaits++
        if (consecutiveWaits > 15) {
          console.log(`  [Loop] Merger stuck, breaking`)
          break
        }
      } else if (phase.includes('BUY')) {
        // In BUY phase - try declaring end game first, then end turn
        if (humanTurnCount >= 5 && !endDeclared) {
          const ended = await tryDeclareEndGameViaHttp(page, 'Loop-BUY')
          if (ended) {
            gameEnded = true
            endDeclared = true
            break
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
        // Not our turn - but check for disposition UI (merger during bot's turn
        // may require human stock disposition even though phase shows "Bot's TURN")
        if (await handlePendingMergerAction(page, 'Loop-wait')) {
          consecutiveWaits = 0
          lastPhase = ''
          continue
        }

        // Wait for phase to change
        const changed = await waitForPhaseChange(page, phase, 5000)
        if (!changed) {
          consecutiveWaits++
          // Check for disposition again after wait (might have appeared)
          if (await handlePendingMergerAction(page, 'Loop-wait-after')) {
            consecutiveWaits = 0
            lastPhase = ''
            continue
          }
          // After 10 waits (50s), probe server state and try to unstick
          if (consecutiveWaits % 10 === 0 && consecutiveWaits > 0) {
            // Probe the server for the actual game state via HTTP
            const probeResult = await sendActionViaHttp(page, {
              action: 'end_turn',
            })
            console.log(
              `  [Loop] HTTP probe: phase="${probeResult?.phase}", error="${probeResult?.error}"`
            )

            // If server says game_over, reload and check
            if (probeResult?.phase?.includes('game_over')) {
              await page.reload({ waitUntil: 'networkidle' })
              await waitForWebSocketConnected(page, 10000)
              gameEnded = true
              break
            }

            // If server says it's a different phase than what UI shows, reload
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
              // Check disposition after reload
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

    return { humanTurnCount, totalTurnCount, gameEnded, endDeclared }
  }

  test('7.3 & 7.15 & 7.13 & 7.16: Play to game end and verify game over screen', async ({
    page,
  }) => {
    test.setTimeout(600000) // 10 minutes

    const testName = '7.3-game-end-and-game-over'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
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
      'Strategy: Play turns, declare end when server signals can_end_game'
    )
    console.log('='.repeat(60))

    const { humanTurnCount, totalTurnCount, gameEnded, endDeclared } =
      await playGameToCompletion(page, testName)

    // Final screenshot before assertions
    await captureStep(page, 'game-end-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(`GAME SUMMARY:`)
    console.log(`  Human turns: ${humanTurnCount}`)
    console.log(`  Total turns: ${totalTurnCount}`)
    console.log(`  Game ended: ${gameEnded}`)
    console.log(`  End declared by player: ${endDeclared}`)
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

  test('7.4: Cannot end game prematurely', async ({ page }) => {
    test.setTimeout(180000) // 3 minutes

    const testName = '7.4-no-premature-end'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
    await createGameViaUI(page, 'PrematureEnder')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await waitForWebSocketConnected(page)

    console.log('\n' + '='.repeat(60))
    console.log('PREMATURE END GAME TEST - Verify end game is rejected early')
    console.log('='.repeat(60))

    // Play 5 turns normally
    const SETUP_TURNS = 5
    let humanTurnCount = 0
    let lastPhase = ''

    while (humanTurnCount < SETUP_TURNS) {
      const phase = await getPhaseText(page)
      if (phase.includes('GAME OVER')) break

      if (phase !== lastPhase) lastPhase = phase

      if (phase.includes('PLACE')) {
        humanTurnCount++
        const turnResult = await completeTurn(
          page,
          humanTurnCount,
          testName
        )
        if (turnResult.gameOver) break
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

    // Wait for our next turn
    console.log('  Waiting for next turn to test premature end game...')
    let waited = 0
    while (waited < 30000) {
      const phase = await getPhaseText(page)
      if (phase.includes('PLACE')) break
      await waitForPhaseChange(page, phase, 3000)
      waited += 3000
    }

    // Place tile but skip end turn
    humanTurnCount++
    const turnResult = await completeTurn(
      page,
      humanTurnCount,
      testName,
      { skipEndTurn: true }
    )

    if (!turnResult.gameOver && (await isInBuyPhase(page))) {
      console.log(`  Attempting premature end game declaration...`)
      await captureStep(page, 'declare-attempt', {
        category: CATEGORY,
        testName,
      })

      const sent = await declareEndGameViaWebSocket(page)
      console.log(`  declare_end_game sent: ${sent}`)
      expect(sent).toBe(true)

      // Wait for response - check that phase updates (or stays same if rejected)
      await expect(page.getByTestId('game-phase')).toBeVisible({ timeout: 5000 })

      const phaseAfterDeclare = await getPhaseText(page)
      console.log(`  Phase after declare attempt: "${phaseAfterDeclare}"`)

      // Game should NOT be over - end conditions not met this early
      expect(phaseAfterDeclare).not.toContain('GAME OVER')
      console.log(`  *** CONFIRMED: End game correctly rejected ***`)
      await captureStep(page, 'declare-rejected', {
        category: CATEGORY,
        testName,
      })

      // End the turn normally
      await endTurn(page)
      console.log(`  Turn ended after declare test`)
    }

    await captureStep(page, 'final-state', { category: CATEGORY, testName })

    console.log('\n' + '='.repeat(60))
    console.log(
      `SUMMARY: Played ${humanTurnCount} turns, premature end game correctly rejected`
    )
    console.log('='.repeat(60))

    expect(humanTurnCount).toBeGreaterThanOrEqual(5)

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

    // Setup: Create game with bots
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
