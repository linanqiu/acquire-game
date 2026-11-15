import { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

let stepCounter = 0

/**
 * Capture a screenshot at a specific step in a test scenario.
 * Screenshots are saved to test-results/{root}/{category}/{testName}/ (root defaults to
 * "scenarios"; journeys pass root "journeys" and no category).
 *
 * @param page - Playwright Page object
 * @param stepName - Descriptive name for this step (e.g., "initial-state", "tile-placed")
 * @param options.category - Test category (e.g., "turn-flow", "trading")
 * @param options.testName - Test name (e.g., "scenario-1.1-basic-turn")
 * @returns Path to the saved screenshot
 */
export async function captureStep(
  page: Page,
  stepName: string,
  options: { category?: string; testName?: string; root?: string } = {}
): Promise<string> {
  stepCounter++
  const paddedStep = String(stepCounter).padStart(2, '0')
  const sanitizedName = stepName.toLowerCase().replace(/\s+/g, '-')

  const root = options.root || 'scenarios'
  const dir =
    root === 'scenarios'
      ? path.join('test-results', root, options.category || 'general', options.testName || 'test')
      : path.join(
          'test-results',
          root,
          ...(options.category ? [options.category] : []),
          options.testName || 'test'
        )

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filename = `${paddedStep}-${sanitizedName}.png`
  const filepath = path.join(dir, filename)

  await page.screenshot({ path: filepath, fullPage: false })
  return filepath
}

/**
 * Reset the step counter. Call this in beforeEach to restart numbering per test.
 */
export function resetStepCounter(): void {
  stepCounter = 0
}

/**
 * Get the current step counter value.
 */
export function getStepCounter(): number {
  return stepCounter
}
