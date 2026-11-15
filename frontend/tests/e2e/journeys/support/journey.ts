/**
 * Tier-4 journey harness.
 *
 * Every journey gets a `journey` fixture that:
 *  - numbers and saves screenshots under test-results/journeys/<journey>/NN-name.png
 *    (through the shared `captureStep` helper);
 *  - logs every action with a prefix;
 *  - listens to console errors and page errors on every page it watches and FAILS the
 *    test at teardown if any unexpected one was seen.
 *
 * Journeys use the UI only. No `/api` calls, no test-mode routes, no snapshots.
 */
import { test as base, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { captureStep, resetStepCounter } from '../../support/screenshot'

export class Journey {
  readonly errors: string[] = []
  private readonly allowed: RegExp[] = []
  readonly started = Date.now()

  constructor(readonly name: string) {
    const dir = path.join('test-results', 'journeys', name)
    fs.rmSync(dir, { recursive: true, force: true })
    resetStepCounter()
  }

  log(msg: string): void {
    const secs = ((Date.now() - this.started) / 1000).toFixed(1)
    console.log(`[${this.name} +${secs}s] ${msg}`)
  }

  /** Screenshot of `page` as the next numbered step. */
  async shot(page: Page, label: string): Promise<void> {
    await captureStep(page, label, { root: 'journeys', testName: this.name })
  }

  /** Console errors matching `re` are expected for the rest of this journey. */
  allow(re: RegExp): void {
    this.allowed.push(re)
  }

  /** Attach console / page-error listeners to `page`. `who` labels the log lines. */
  watch(page: Page, who: string): void {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (this.allowed.some((re) => re.test(text))) {
        this.log(`(${who}) expected console error: ${text}`)
        return
      }
      this.log(`(${who}) CONSOLE ERROR: ${text}`)
      this.errors.push(`[${who}] console: ${text}`)
    })
    page.on('pageerror', (err) => {
      this.log(`(${who}) PAGE ERROR: ${err.message}`)
      this.errors.push(`[${who}] pageerror: ${err.message}`)
    })
  }

  assertClean(): void {
    expect(this.errors, 'unexpected console/page errors during the journey').toEqual([])
  }
}

export const test = base.extend<{ journey: Journey }>({
  journey: async ({ page }, provide, testInfo) => {
    // One test per journey file: the file name is the journey name.
    const j = new Journey(path.basename(testInfo.file).replace(/\.spec\.ts$/, ''))
    j.watch(page, 'p1')
    await provide(j)
    j.log(`finished in ${((Date.now() - j.started) / 1000).toFixed(1)}s`)
    j.assertClean()
  },
})

export { expect }
