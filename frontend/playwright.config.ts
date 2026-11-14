import { defineConfig, devices } from '@playwright/test'
import { BENCH_DIR, TRANSCRIPT_DIR } from './tests/e2e/transcripts/dirs'

// Allow overriding the browser binary (e.g. when the pinned Playwright build isn't installed).
const browserLaunch = process.env.PW_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
  : {}

// Ports are overridable so two suites (e.g. parallel worktrees) can run side by side
// without one silently reusing the other's servers. The Vite proxy follows
// VITE_BACKEND_PORT (see vite.config.ts).
const BACKEND_PORT = process.env.PW_BACKEND_PORT ?? '8000'
const FRONTEND_PORT = process.env.PW_FRONTEND_PORT ?? '5173'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    trace: 'on-first-retry',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'journeys',
      testDir: './tests/e2e/journeys',
      use: { ...devices['Desktop Chrome'], ...browserLaunch },
    },
    {
      name: 'screens',
      testDir: './tests/e2e/screens',
      use: { ...devices['Desktop Chrome'], ...browserLaunch },
    },
    {
      // Transcript viewer + Acquire Bench against the real backend (see tests/e2e/transcripts).
      name: 'transcripts',
      testDir: './tests/e2e/transcripts',
      timeout: 600000,
      use: { ...devices['Desktop Chrome'], ...browserLaunch },
    },
  ],
  webServer: [
    {
      command: `python3 -m uvicorn main:app --host 127.0.0.1 --port ${BACKEND_PORT}`,
      cwd: '../backend',
      url: `http://127.0.0.1:${BACKEND_PORT}/docs`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ACQUIRE_GAME_SEED: '2',
        ACQUIRE_TEST_MODE: '1',
        // Where the transcripts spec's standalone benchmark run is served from (/bench/*),
        // and where live games write their transcripts (keeps the source tree clean).
        ACQUIRE_BENCH_DIR: BENCH_DIR,
        ACQUIRE_TRANSCRIPT_DIR: TRANSCRIPT_DIR,
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, VITE_BACKEND_PORT: BACKEND_PORT },
    },
  ],
})
