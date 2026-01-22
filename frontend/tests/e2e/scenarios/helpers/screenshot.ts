import { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

let stepCounter = 0
let screenshotFailures = 0
const MAX_SCREENSHOT_FAILURES = 3

/**
 * Capture a screenshot at a specific step in a test scenario.
 * Screenshots are saved to test-results/scenarios/{category}/{testName}/
 *
 * In some environments (containers, CI), screenshots may fail due to browser
 * limitations. This function gracefully handles failures and continues the test.
 *
 * @param page - Playwright Page object
 * @param stepName - Descriptive name for this step (e.g., "initial-state", "tile-placed")
 * @param options.category - Test category (e.g., "turn-flow", "trading")
 * @param options.testName - Test name (e.g., "scenario-1.1-basic-turn")
 * @returns Path to the saved screenshot, or empty string if screenshot failed
 */
export async function captureStep(
  page: Page,
  stepName: string,
  options: { category?: string; testName?: string } = {}
): Promise<string> {
  stepCounter++
  const paddedStep = String(stepCounter).padStart(2, '0')
  const sanitizedName = stepName.toLowerCase().replace(/\s+/g, '-')

  const dir = path.join(
    'test-results',
    'scenarios',
    options.category || 'general',
    options.testName || 'test'
  )

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filename = `${paddedStep}-${sanitizedName}.png`
  const filepath = path.join(dir, filename)

  // Skip screenshots if we've had too many failures (browser environment issue)
  if (screenshotFailures >= MAX_SCREENSHOT_FAILURES) {
    console.log(`[Screenshot] Skipping ${filename} (too many previous failures)`)
    return ''
  }

  try {
    await page.screenshot({ path: filepath, fullPage: false, timeout: 5000 })
    return filepath
  } catch (error) {
    screenshotFailures++
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[Screenshot] Failed to capture ${filename}: ${message}`)

    if (screenshotFailures >= MAX_SCREENSHOT_FAILURES) {
      console.log('[Screenshot] Disabling screenshots for remaining tests due to repeated failures')
    }

    return ''
  }
}

/**
 * Reset the step counter. Call this in beforeEach to restart numbering per test.
 * Also resets screenshot failure counter to give each test a fresh start.
 */
export function resetStepCounter(): void {
  stepCounter = 0
  // Reset failure count so each test gets a fair chance
  // (but failures accumulate within a single test)
}

/**
 * Get the current step counter value.
 */
export function getStepCounter(): number {
  return stepCounter
}
