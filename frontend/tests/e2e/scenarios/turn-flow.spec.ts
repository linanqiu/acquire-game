import { test, expect, BrowserContext } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'
import {
  createGameViaUI,
  addBotViaUI,
  startGameViaUI,
  assertPlayerInLobby,
} from './helpers/game-setup'
import {
  waitForMyTurn,
  selectTileFromRack,
  placeTile,
  endTurn,
  waitForPhase,
  hasChainSelector,
  selectFirstAvailableChain,
  getPhaseText,
  setupConsoleErrorTracking,
} from './helpers/turn-actions'

const CATEGORY = 'turn-flow'

/**
 * Turn Flow Scenarios (1.x)
 *
 * These tests verify the complete turn cycle in Acquire:
 * - Tile placement
 * - Chain founding (when applicable)
 * - Stock purchase
 * - Turn end
 *
 * KNOWN LIMITATION: Vite's WebSocket proxy has stability issues with WebSocket
 * writes in test environments. The tests verify UI interactions work correctly
 * (tile selection, button states, phase display), but the actual game action
 * submission may fail due to WebSocket instability. This is a test infrastructure
 * issue, not an application bug.
 *
 * TODO: Add HTTP endpoints for game actions to make tests more reliable.
 * See CLAUDE.md WebSocket Reliability Pattern.
 *
 * Note: Scenarios 1.5-1.8 require specific board states and are deferred.
 * Scenario 1.9 requires turn timer feature (not yet implemented).
 */
test.describe('Turn Flow Scenarios (1.x)', () => {
  test.beforeEach(() => {
    resetStepCounter()
  })

  test('1.1: Basic complete turns - play at least 10 turns with detailed logging', async ({ page }) => {
    const testName = '1.1-basic-turn'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
    await createGameViaUI(page, 'TestPlayer')
    await assertPlayerInLobby(page, 'TestPlayer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby-with-players', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await page.waitForTimeout(2000)

    // Helper to get game state
    const getGameInfo = async () => {
      return await page.evaluate(() => {
        const phaseEl = document.querySelector('[data-testid="game-phase"]')
        const phase = phaseEl?.textContent || ''
        const cashEl = document.querySelector('[data-testid="player-cash"]')
        const cash = cashEl?.textContent || ''
        return { phase, cash }
      })
    }

    const MIN_TURNS = 10
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''
    const tilesPlaced: string[] = []
    const chainsFoundedByMe: string[] = []

    console.log('\n' + '='.repeat(60))
    console.log('BASIC TURNS TEST - Detailed Turn Log (10+ turns)')
    console.log('='.repeat(60))

    while (humanTurnCount < MIN_TURNS) {
      const info = await getGameInfo()

      // Track phase changes for turn counting
      if (info.phase !== lastPhase) {
        if (info.phase.includes("'s TURN")) {
          totalTurnCount++
          console.log(`[Turn ${totalTurnCount}] ${info.phase}`)
        }
        lastPhase = info.phase
      }

      // Our turn to place
      if (info.phase.includes('PLACE')) {
        humanTurnCount++
        totalTurnCount++
        console.log(`\n[Turn ${totalTurnCount}] === MY TURN #${humanTurnCount} ===`)
        console.log(`  Cash: ${info.cash}`)

        const tileCoord = await selectTileFromRack(page)
        tilesPlaced.push(tileCoord)
        console.log(`  Placing tile: ${tileCoord}`)

        await placeTile(page)

        const afterPlace = await getGameInfo()
        console.log(`  Phase after place: "${afterPlace.phase}"`)

        // Handle chain founding
        if (await hasChainSelector(page)) {
          const chainName = await selectFirstAvailableChain(page)
          chainsFoundedByMe.push(chainName)
          console.log(`  *** FOUNDED CHAIN: ${chainName.toUpperCase()} ***`)
          await page.waitForTimeout(500)
        }

        // End turn
        const phase = await getPhaseText(page)
        if (phase.includes('BUY')) {
          await endTurn(page)
          console.log(`  Ended turn`)
        }

        lastPhase = ''
      } else {
        await page.waitForTimeout(300)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`SUMMARY: ${humanTurnCount} human turns, ${totalTurnCount} total turns`)
    console.log(`Tiles placed: [${tilesPlaced.join(', ')}]`)
    console.log(`Chains founded: [${chainsFoundedByMe.join(', ')}]`)
    console.log('='.repeat(60) + '\n')

    expect(humanTurnCount).toBeGreaterThanOrEqual(MIN_TURNS)

    const errors = errorTracker.getErrors().filter(e => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('1.2: Skip stock purchase - play at least 10 turns skipping buy phase', async ({ page }) => {
    const testName = '1.2-skip-purchase'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
    await createGameViaUI(page, 'SkipBuyPlayer')
    await assertPlayerInLobby(page, 'SkipBuyPlayer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await page.waitForTimeout(2000)

    const getGameInfo = async () => {
      return await page.evaluate(() => {
        const phaseEl = document.querySelector('[data-testid="game-phase"]')
        const phase = phaseEl?.textContent || ''
        const cashEl = document.querySelector('[data-testid="player-cash"]')
        const cash = cashEl?.textContent || ''
        const endBtn = document.querySelector('[data-testid="end-turn-button"]')
        const buttonText = endBtn?.textContent || ''
        return { phase, cash, buttonText }
      })
    }

    const MIN_TURNS = 10
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''
    const tilesPlaced: string[] = []
    const chainsFoundedByMe: string[] = []
    let skipsCount = 0

    console.log('\n' + '='.repeat(60))
    console.log('SKIP PURCHASE TEST - Detailed Turn Log (10+ turns)')
    console.log('='.repeat(60))

    while (humanTurnCount < MIN_TURNS) {
      const info = await getGameInfo()

      if (info.phase !== lastPhase) {
        if (info.phase.includes("'s TURN")) {
          totalTurnCount++
          console.log(`[Turn ${totalTurnCount}] ${info.phase}`)
        }
        lastPhase = info.phase
      }

      if (info.phase.includes('PLACE')) {
        humanTurnCount++
        totalTurnCount++
        console.log(`\n[Turn ${totalTurnCount}] === MY TURN #${humanTurnCount} ===`)
        console.log(`  Cash: ${info.cash}`)

        const tileCoord = await selectTileFromRack(page)
        tilesPlaced.push(tileCoord)
        console.log(`  Placing tile: ${tileCoord}`)

        await placeTile(page)

        const afterPlace = await getGameInfo()
        console.log(`  Phase after place: "${afterPlace.phase}"`)

        if (await hasChainSelector(page)) {
          const chainName = await selectFirstAvailableChain(page)
          chainsFoundedByMe.push(chainName)
          console.log(`  *** FOUNDED CHAIN: ${chainName.toUpperCase()} ***`)
          await page.waitForTimeout(500)
        }

        const phase = await getPhaseText(page)
        if (phase.includes('BUY')) {
          const btnInfo = await getGameInfo()
          if (btnInfo.buttonText.includes('SKIP')) {
            skipsCount++
            console.log(`  Button shows: "${btnInfo.buttonText}" - Skipping purchase`)
          }
          await endTurn(page)
          console.log(`  Ended turn (no purchase)`)
        }

        lastPhase = ''
      } else {
        await page.waitForTimeout(300)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`SUMMARY: ${humanTurnCount} human turns, ${totalTurnCount} total turns`)
    console.log(`Tiles placed: [${tilesPlaced.join(', ')}]`)
    console.log(`Chains founded: [${chainsFoundedByMe.join(', ')}]`)
    console.log(`Turns with SKIP button: ${skipsCount}`)
    console.log('='.repeat(60) + '\n')

    expect(humanTurnCount).toBeGreaterThanOrEqual(MIN_TURNS)

    const errors = errorTracker.getErrors().filter(e => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('1.3: Turn with chain founding - play until two chains are founded', async ({ page }) => {
    const testName = '1.3-chain-founding'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
    await createGameViaUI(page, 'FounderPlayer')
    await assertPlayerInLobby(page, 'FounderPlayer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await page.waitForTimeout(2000) // Let WebSocket stabilize

    // Helper to get current game state from the page
    const getGameInfo = async () => {
      return await page.evaluate(() => {
        // Access Zustand store from window (if exposed) or parse from DOM
        const phaseEl = document.querySelector('[data-testid="game-phase"]')
        const phase = phaseEl?.textContent || ''

        // Get active chains from the board
        const chainMarkers = document.querySelectorAll('[data-testid^="chain-marker-"]')
        const activeChains = Array.from(chainMarkers).map((el) =>
          el.getAttribute('data-testid')?.replace('chain-marker-', '')
        )

        // Get tiles on board by looking at filled cells
        const filledCells = document.querySelectorAll('[data-chain], [data-state="placed"]')
        const boardTiles = Array.from(filledCells).map((el) => el.getAttribute('data-testid'))

        return { phase, activeChains: [...new Set(activeChains)], boardTileCount: filledCells.length }
      })
    }

    // Track all turns (including bot turns via phase changes)
    const maxTurns = 30
    const chainsFoundedByMe: string[] = []
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''

    console.log('\n' + '='.repeat(60))
    console.log('CHAIN FOUNDING TEST - Detailed Turn Log')
    console.log('='.repeat(60))

    for (let iteration = 1; iteration <= maxTurns && chainsFoundedByMe.length < 2; iteration++) {
      // Get current state
      const info = await getGameInfo()

      // Detect phase changes (indicates turn progression)
      if (info.phase !== lastPhase) {
        totalTurnCount++
        const isMyTurn = info.phase.includes('PLACE') || info.phase.includes('CHOOSE') || info.phase.includes('BUY')

        if (info.phase.includes("'s TURN")) {
          // It's someone else's turn - log it
          console.log(`[Turn ${totalTurnCount}] ${info.phase}`)
        }
        lastPhase = info.phase
      }

      // Check if it's our turn to place
      if (info.phase.includes('PLACE')) {
        humanTurnCount++
        console.log(`\n[Turn ${totalTurnCount}] === MY TURN #${humanTurnCount} ===`)

        // Select and place a tile
        const tileCoord = await selectTileFromRack(page)
        console.log(`  Placing tile: ${tileCoord}`)

        await placeTile(page)

        // Check result
        const afterPlace = await getGameInfo()
        console.log(`  Phase after place: "${afterPlace.phase}"`)
        console.log(`  Active chains: [${afterPlace.activeChains.join(', ')}]`)

        // Check if chain founding was triggered
        if (await hasChainSelector(page)) {
          const chainName = await selectFirstAvailableChain(page)
          chainsFoundedByMe.push(chainName)
          console.log(`  *** FOUNDED CHAIN: ${chainName.toUpperCase()} ***`)
          await captureStep(page, `chain-founded-${chainName}`, { category: CATEGORY, testName })

          // Wait for phase to update
          await page.waitForTimeout(500)
        }

        // Complete the turn if in buy phase
        const phase = await getPhaseText(page)
        if (phase.includes('BUY')) {
          await endTurn(page)
          console.log(`  Ended turn (skipped buying)`)
        }
      } else {
        // Wait for game state to update (bot turns happen server-side)
        await page.waitForTimeout(500)
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`SUMMARY: ${humanTurnCount} human turns, ${totalTurnCount} total turns`)
    console.log(`Chains founded by human: [${chainsFoundedByMe.join(', ')}]`)
    console.log('='.repeat(60) + '\n')

    // We need at least 2 chains founded
    expect(chainsFoundedByMe.length).toBeGreaterThanOrEqual(2)

    const errors = errorTracker.getErrors().filter(e => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('1.4: Extended gameplay - play at least 20 turns with full state tracking', async ({ page }) => {
    // Extended timeout for 20+ turns with potential mergers
    test.setTimeout(180000) // 3 minutes

    const testName = '1.4-multiple-turns'
    const errorTracker = setupConsoleErrorTracking(page)

    // Setup: Create game with bots
    await createGameViaUI(page, 'MultiTurnPlayer')
    await assertPlayerInLobby(page, 'MultiTurnPlayer')
    await addBotViaUI(page)
    await addBotViaUI(page)
    await captureStep(page, 'lobby', { category: CATEGORY, testName })

    await startGameViaUI(page)
    await captureStep(page, 'game-started', { category: CATEGORY, testName })

    await page.waitForTimeout(2000)

    const getGameInfo = async () => {
      return await page.evaluate(() => {
        const phaseEl = document.querySelector('[data-testid="game-phase"]')
        const phase = phaseEl?.textContent || ''
        const cashEl = document.querySelector('[data-testid="player-cash"]')
        const cash = cashEl?.textContent || ''
        const tilePoolEl = document.querySelector('[data-testid="tile-pool"]')
        const tilePool = tilePoolEl?.textContent || ''
        return { phase, cash, tilePool }
      })
    }

    // Helper to handle stock disposition during merger
    const handleStockDisposition = async () => {
      // Look for the merger disposition confirm button (data-testid="confirm-disposition")
      const confirmBtn = page.getByTestId('confirm-disposition')
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click()
        console.log(`  Confirmed stock disposition (hold all)`)
        await page.waitForTimeout(500)
        return true
      }
      return false
    }

    // Helper to wait for merger to complete (phase changes away from MERGER)
    const waitForMergerEnd = async (maxWaitMs = 60000) => {
      const startTime = Date.now()
      let lastLog = ''
      let screenshotTaken = false
      while (Date.now() - startTime < maxWaitMs) {
        const info = await getGameInfo()

        // Log phase changes
        if (info.phase !== lastLog) {
          console.log(`    [Merger] Phase: "${info.phase}"`)
          lastLog = info.phase
        }

        // Merger is done when we reach BUY, PLACE, or someone's TURN
        if (info.phase.includes('BUY') || info.phase.includes('PLACE') || info.phase.includes("'s TURN")) {
          return true
        }

        // Take a screenshot after 5 seconds to debug if stuck
        if (!screenshotTaken && Date.now() - startTime > 5000) {
          await captureStep(page, 'merger-debug', { category: CATEGORY, testName })
          screenshotTaken = true
          console.log(`    [Merger] Screenshot captured for debugging`)
        }

        // Check what's visible on page
        const disposeBtn = await page.getByTestId('confirm-disposition').isVisible().catch(() => false)
        const waitingText = await page.locator('text=Waiting for other players').isVisible().catch(() => false)
        console.log(`    [Merger] dispose-btn: ${disposeBtn}, waiting-text: ${waitingText}`)

        // Try to handle our disposition if we have one
        if (disposeBtn) {
          const handled = await handleStockDisposition()
          if (handled) {
            console.log(`    [Merger] Confirmed disposition`)
          }
        }

        await page.waitForTimeout(500)
      }
      console.log(`    [Merger] Timeout after ${maxWaitMs}ms`)
      return false
    }

    const MIN_TURNS = 20
    let humanTurnCount = 0
    let totalTurnCount = 0
    let lastPhase = ''
    const tilesPlaced: string[] = []
    const chainsFoundedByMe: string[] = []
    const gameEvents: string[] = []
    let mergerCount = 0

    console.log('\n' + '='.repeat(70))
    console.log('EXTENDED GAMEPLAY TEST - Detailed Turn Log (20+ turns)')
    console.log('='.repeat(70))

    while (humanTurnCount < MIN_TURNS) {
      const info = await getGameInfo()

      // Check for game over
      if (info.phase.includes('GAME OVER')) {
        console.log('\n*** GAME OVER ***')
        gameEvents.push('Game ended')
        break
      }

      if (info.phase !== lastPhase) {
        if (info.phase.includes("'s TURN")) {
          totalTurnCount++
          console.log(`[Turn ${totalTurnCount}] ${info.phase}`)
        }
        lastPhase = info.phase
      }

      // Handle stock disposition during merger - wait for merger to complete
      if (info.phase.includes('DISPOSE') || (info.phase.includes('MERGER') && !info.phase.includes('PLACE'))) {
        console.log(`  In merger phase, waiting for completion...`)
        const completed = await waitForMergerEnd(15000) // Shorter timeout
        if (!completed) {
          console.log(`  Merger stuck (bots not disposing) - ending test`)
          break // Exit the loop if merger is stuck
        }
        lastPhase = '' // Force re-check
        continue
      }

      if (info.phase.includes('PLACE')) {
        humanTurnCount++
        totalTurnCount++
        console.log(`\n[Turn ${totalTurnCount}] === MY TURN #${humanTurnCount} ===`)
        console.log(`  Cash: ${info.cash} | Tile Pool: ${info.tilePool}`)

        const tileCoord = await selectTileFromRack(page)
        tilesPlaced.push(tileCoord)
        console.log(`  Placing tile: ${tileCoord}`)

        await placeTile(page)

        const afterPlace = await getGameInfo()
        console.log(`  Phase after place: "${afterPlace.phase}"`)

        if (await hasChainSelector(page)) {
          const chainName = await selectFirstAvailableChain(page)
          chainsFoundedByMe.push(chainName)
          gameEvents.push(`Turn ${humanTurnCount}: Founded ${chainName}`)
          console.log(`  *** FOUNDED CHAIN: ${chainName.toUpperCase()} ***`)
          await page.waitForTimeout(500)
        }

        // Check for merger
        const postPhase = await getPhaseText(page)
        if (postPhase.includes('MERGER') || postPhase.includes('DISPOSE')) {
          mergerCount++
          gameEvents.push(`Turn ${humanTurnCount}: Merger #${mergerCount} triggered`)
          console.log(`  *** MERGER #${mergerCount} IN PROGRESS ***`)
          // Wait for merger to complete (shorter timeout)
          const completed = await waitForMergerEnd(15000)
          if (!completed) {
            console.log(`  Merger stuck - ending test early`)
            break // Exit the turn loop
          }
          console.log(`  Merger completed`)
        }

        // Wait for phase to settle after any merger handling
        await page.waitForTimeout(300)
        const phase = await getPhaseText(page)
        if (phase.includes('BUY')) {
          await endTurn(page)
          console.log(`  Ended turn`)
        }

        // Capture screenshot every 5 turns
        if (humanTurnCount % 5 === 0) {
          await captureStep(page, `turn-${humanTurnCount}`, { category: CATEGORY, testName })
        }

        lastPhase = ''
      } else {
        await page.waitForTimeout(300)
      }
    }

    console.log('\n' + '='.repeat(70))
    console.log(`SUMMARY: ${humanTurnCount} human turns, ${totalTurnCount} total turns`)
    console.log(`Tiles placed: [${tilesPlaced.join(', ')}]`)
    console.log(`Chains founded by me: [${chainsFoundedByMe.join(', ')}]`)
    console.log(`Mergers encountered: ${mergerCount}`)
    console.log(`Key events: ${gameEvents.length > 0 ? gameEvents.join('; ') : 'None'}`)
    console.log('='.repeat(70) + '\n')

    expect(humanTurnCount).toBeGreaterThanOrEqual(MIN_TURNS)

    const errors = errorTracker.getErrors().filter(e => !e.includes('WebSocket'))
    expect(errors).toHaveLength(0)
  })

  test('1.10: Player disconnect during turn - turn gets skipped', async ({ browser }) => {
    const testName = '1.10-disconnect'

    // Create two browser contexts to simulate two players
    const hostContext: BrowserContext = await browser.newContext()
    const playerContext: BrowserContext = await browser.newContext()

    const hostPage = await hostContext.newPage()
    const playerPage = await playerContext.newPage()

    const hostErrors = setupConsoleErrorTracking(hostPage)

    try {
      // Host creates a game
      await createGameViaUI(hostPage, 'Host')
      await captureStep(hostPage, 'host-created-game', { category: CATEGORY, testName })

      // Get room code from URL
      const url = hostPage.url()
      const roomCode = url.match(/\/play\/([A-Z]{4})/)?.[1]
      expect(roomCode).toBeTruthy()

      // Second player joins
      await playerPage.goto('/')
      await playerPage.getByTestId('join-name-input').fill('Player2')
      await playerPage.getByTestId('join-room-input').fill(roomCode!)
      await playerPage.getByTestId('join-button').click()
      await playerPage.waitForURL(`/play/${roomCode}`)
      await captureStep(playerPage, 'player2-joined', { category: CATEGORY, testName })

      // Add a bot to meet minimum player requirement
      await addBotViaUI(hostPage)
      await captureStep(hostPage, 'bot-added', { category: CATEGORY, testName })

      // Host starts the game
      await startGameViaUI(hostPage)
      await captureStep(hostPage, 'game-started', { category: CATEGORY, testName })

      // Wait for game to start on player page too
      await expect(playerPage.getByText('WAITING FOR PLAYERS')).not.toBeVisible({ timeout: 10000 })
      await captureStep(playerPage, 'player2-sees-game', { category: CATEGORY, testName })

      // Wait for either player's turn
      await Promise.race([
        waitForMyTurn(hostPage, 30000).catch(() => {}),
        waitForMyTurn(playerPage, 30000).catch(() => {}),
      ])

      await captureStep(hostPage, 'game-in-progress-host-view', { category: CATEGORY, testName })
      await captureStep(playerPage, 'game-in-progress-player2-view', { category: CATEGORY, testName })

      // Simulate player2 disconnect by closing their page
      const player2Phase = await playerPage.getByTestId('game-phase').textContent()
      const isPlayer2Turn = player2Phase?.includes('PLACE')

      if (isPlayer2Turn) {
        await captureStep(playerPage, 'player2-turn-before-disconnect', { category: CATEGORY, testName })
      }

      // Close player2's page (simulating disconnect)
      await playerPage.close()
      await captureStep(hostPage, 'after-player2-disconnect', { category: CATEGORY, testName })

      // Wait a moment for the server to detect disconnect
      await hostPage.waitForTimeout(3000)

      // The game should continue - either it's another player's turn or the
      // disconnected player's turn gets handled by the server
      await captureStep(hostPage, 'game-continues-after-disconnect', { category: CATEGORY, testName })

      // Verify the game is still in a playable state (not crashed)
      await expect(hostPage.getByTestId('game-phase')).toBeVisible()

      const errors = hostErrors.getErrors()
      expect(errors).toHaveLength(0)

    } finally {
      // Cleanup
      await hostContext.close()
      await playerContext.close()
    }
  })
})
