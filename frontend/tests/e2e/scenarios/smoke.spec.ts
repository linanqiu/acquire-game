import { test, expect } from '@playwright/test'
import { captureStep, resetStepCounter } from './helpers/screenshot'

/**
 * Smoke tests to verify the E2E scenario test infrastructure is working.
 * These tests validate that:
 * - Screenshots can be captured and saved
 * - Console errors are detected
 * - Basic page navigation works
 */
test.describe('Scenario Test Infrastructure Smoke Test', () => {
  test.beforeEach(() => {
    resetStepCounter()
  })

  test('should capture screenshots at each step', async ({ page }) => {
    // Navigate to lobby
    await page.goto('/')
    const path1 = await captureStep(page, 'lobby-loaded', {
      category: 'smoke',
      testName: 'screenshot-test',
    })
    expect(path1).toContain('01-lobby-loaded.png')

    // Verify lobby elements
    await expect(page.getByRole('heading', { name: 'ACQUIRE' })).toBeVisible()
    const path2 = await captureStep(page, 'lobby-verified', {
      category: 'smoke',
      testName: 'screenshot-test',
    })
    expect(path2).toContain('02-lobby-verified.png')
  })

  test('should capture console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    await page.goto('/')
    await page.waitForTimeout(1000) // Allow any errors to surface

    // Filter out expected errors (favicon, etc)
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('should verify lobby page structure', async ({ page }) => {
    await page.goto('/')
    await captureStep(page, 'lobby-initial', {
      category: 'smoke',
      testName: 'lobby-structure',
    })

    // Verify create game section
    const createSection = page.locator('text=CREATE GAME')
    await expect(createSection).toBeVisible()

    // Verify join game section
    const joinSection = page.locator('text=JOIN GAME')
    await expect(joinSection).toBeVisible()

    await captureStep(page, 'lobby-structure-verified', {
      category: 'smoke',
      testName: 'lobby-structure',
    })
  })
})
