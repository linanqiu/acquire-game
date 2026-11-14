/**
 * Base `test` for screen tests: console/pageerror guard (fails the test on unexpected errors)
 * and a numbered screenshot helper saving to test-results/screens/<test>/NN-name.png.
 */
import { test as base, expect, type Page, type TestInfo } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/** Console errors that are expected and harmless. Keep this list short and specific. */
const IGNORED_ERRORS: RegExp[] = []

export class Shots {
  private n = 0
  private readonly dir: string
  constructor(testInfo: TestInfo) {
    const slug = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
    this.dir = path.join('test-results', 'screens', slug)
    fs.rmSync(this.dir, { recursive: true, force: true })
  }
  async take(page: Page, name: string, opts: { fullPage?: boolean } = {}): Promise<string> {
    fs.mkdirSync(this.dir, { recursive: true })
    this.n += 1
    const file = path.join(this.dir, `${String(this.n).padStart(2, '0')}-${name}.png`)
    await page.screenshot({ path: file, fullPage: opts.fullPage ?? true })
    return file
  }
}

export class ErrorGuard {
  readonly errors: string[] = []
  private readonly allowed: RegExp[] = []
  /** Declare an error this test provokes on purpose (e.g. a failure toast test). */
  allow(...patterns: RegExp[]): void {
    this.allowed.push(...patterns)
  }
  watch(page: Page, label = 'page'): void {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (IGNORED_ERRORS.some((re) => re.test(text))) return
      if (this.allowed.some((re) => re.test(text))) return
      this.errors.push(`[${label} console.error] ${text}`)
    })
    page.on('pageerror', (err) => {
      this.errors.push(`[${label} pageerror] ${err.message}`)
    })
  }
}

export const test = base.extend<{ shots: Shots; guard: ErrorGuard }>({
  // Playwright requires the destructuring pattern for the fixtures argument, even when empty.
  // eslint-disable-next-line no-empty-pattern
  shots: async ({}, provide, testInfo) => {
    await provide(new Shots(testInfo))
  },
  guard: [
    async ({ page }, provide) => {
      const guard = new ErrorGuard()
      guard.watch(page)
      await provide(guard)
      expect(guard.errors, 'unexpected browser console errors / page errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
