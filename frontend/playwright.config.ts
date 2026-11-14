import { defineConfig, devices } from '@playwright/test'
import { BENCH_DIR, TRANSCRIPT_DIR } from './tests/e2e/transcripts/dirs'

// Allow overriding the browser binary (e.g. when the pinned Playwright build isn't installed).
const browserLaunch = process.env.PW_CHROMIUM_PATH
  ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
  : {}

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
    baseURL: 'http://127.0.0.1:5173',
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
    {
      name: 'legacy',
      testDir: './tests/e2e',
      testIgnore: ['**/journeys/**', '**/screens/**', '**/transcripts/**'],
      use: { ...devices['Desktop Chrome'], ...browserLaunch },
    },
  ],
  webServer: [
    {
      command: 'python3 -m uvicorn main:app --host 127.0.0.1 --port 8000',
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/docs',
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
      command: 'npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
