import { defineConfig, devices } from '@playwright/test'
import * as os from 'os'
import * as path from 'path'

/**
 * Themed rulesets end to end (tests/e2e/themes): the same spec runs once against a server
 * started with GAME_RULESET=valley and once against GAME_RULESET=mini. Each ruleset gets its
 * OWN backend + Vite pair on its own ports (never reused from another suite: a classic server
 * on the same port would make the test meaningless), so this lives in its own config.
 *
 *   npm run e2e:themes            (PW_CHROMIUM_PATH=... to pick the browser binary)
 *
 * Ports: PW_THEMES_PORT_BASE (default 8300) -> valley backend +0 / frontend +100,
 * mini backend +1 / frontend +101.
 */
const browserLaunch = process.env.PW_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
  : {}

const BASE = Number(process.env.PW_THEMES_PORT_BASE ?? 8300)
const ROOT = process.env.ACQUIRE_E2E_DIR ?? path.join(os.tmpdir(), 'acquire-e2e-themes')

const THEMES = [
  { ruleset: 'valley', backend: BASE, frontend: BASE + 100 },
  { ruleset: 'mini', backend: BASE + 1, frontend: BASE + 101 },
]

export default defineConfig({
  testDir: './tests/e2e/themes',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-themes' }]],
  timeout: 300_000,
  expect: { timeout: 15_000 },
  use: { trace: 'off', actionTimeout: 15_000 },
  projects: THEMES.map((t) => ({
    name: `themes-${t.ruleset}`,
    metadata: { ruleset: t.ruleset },
    use: {
      ...devices['Desktop Chrome'],
      ...browserLaunch,
      baseURL: `http://127.0.0.1:${t.frontend}`,
      viewport: { width: 1366, height: 768 },
    },
  })),
  webServer: THEMES.flatMap((t) => [
    {
      command: `python3 -m uvicorn main:app --host 127.0.0.1 --port ${t.backend}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${t.backend}/config/game`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
      env: {
        ...process.env,
        GAME_RULESET: t.ruleset,
        ACQUIRE_GAME_SEED: '2',
        ACQUIRE_TRANSCRIPT_DIR: path.join(ROOT, t.ruleset, 'transcripts'),
        ACQUIRE_BENCH_DIR: path.join(ROOT, t.ruleset, 'bench'),
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${t.frontend} --strictPort`,
      url: `http://127.0.0.1:${t.frontend}`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
      env: { ...process.env, VITE_BACKEND_PORT: String(t.backend) },
    },
  ]),
})
