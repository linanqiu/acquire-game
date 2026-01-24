/**
 * Deterministic backend server fixture for scenario tests.
 *
 * This module provides functions to start and stop the backend server with
 * a specific tile order CSV file for deterministic gameplay.
 *
 * Available tile sequences:
 * - 'default.csv' - General purpose, chain founding on turn 2
 * - 'three-tile-founding.csv' - Three-tile chain founding on turn 3
 * - 'depleted-stock.csv' - Quick stock depletion scenario
 * - 'seven-chains.csv' - All 7 chains on board scenario
 *
 * Usage in tests:
 *
 *   import { test } from '@playwright/test'
 *   import { useDeterministicBackend } from '../fixtures/deterministic-server'
 *
 *   test.describe('My Test Suite', () => {
 *     useDeterministicBackend('default.csv')
 *
 *     test('my test', async ({ page }) => {
 *       // Test code here - backend runs with deterministic tiles
 *     })
 *   })
 */
import { test } from '@playwright/test'
import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const execAsync = promisify(exec)

let backendProcess: ChildProcess | null = null
let serverStarted = false

async function waitForServer(url: string, timeout: number = 30000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

async function killBackendServer(): Promise<void> {
  try {
    await execAsync('pkill -9 -f "uvicorn main:app" || true')
    // Wait for port to be released
    await new Promise((resolve) => setTimeout(resolve, 2000))
  } catch {
    // Ignore errors
  }
}

/**
 * Start the backend server with a specific tile order CSV file.
 * This will kill any existing backend server first.
 *
 * @param tileOrderCsv - Name of the CSV file in fixtures/tile-sequences/
 */
export async function startDeterministicBackend(tileOrderCsv: string): Promise<void> {
  if (serverStarted) {
    console.log(`[deterministic-server] Server already started, skipping`)
    return
  }

  const tileOrderFile = path.resolve(__dirname, 'tile-sequences', tileOrderCsv)
  const backendDir = path.resolve(__dirname, '../../../../backend')

  console.log(`[deterministic-server] Starting backend with tile order: ${tileOrderCsv}`)

  // Kill any existing backend server
  await killBackendServer()

  // Start the backend server with the tile order file
  backendProcess = spawn(
    'python3',
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        ACQUIRE_GAME_SEED: '2',
        ACQUIRE_TILE_ORDER_FILE: tileOrderFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    }
  )

  // Log server output (condensed)
  backendProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg && !msg.includes('127.0.0.1')) {
      console.log(`[backend] ${msg}`)
    }
  })
  backendProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) console.error(`[backend] ${msg}`)
  })

  backendProcess.on('error', (err) => {
    console.error(`[deterministic-server] Process error: ${err.message}`)
  })

  // Wait for server to be ready
  const ready = await waitForServer('http://127.0.0.1:8000/docs', 30000)
  if (!ready) {
    throw new Error('[deterministic-server] Backend server failed to start within timeout')
  }

  serverStarted = true
  console.log(`[deterministic-server] Backend ready with ${tileOrderCsv}`)
}

/**
 * Stop the deterministic backend server.
 */
export async function stopDeterministicBackend(): Promise<void> {
  console.log('[deterministic-server] Stopping backend server...')

  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    if (!backendProcess.killed) {
      backendProcess.kill('SIGKILL')
    }
    backendProcess = null
  }

  // Also kill any remaining processes
  await killBackendServer()
  serverStarted = false

  console.log('[deterministic-server] Backend server stopped')
}

/**
 * Playwright test fixture that starts and stops the deterministic backend
 * for a describe block.
 *
 * @param tileOrderCsv - Name of the CSV file in fixtures/tile-sequences/
 *
 * Usage:
 *   test.describe('My Suite', () => {
 *     useDeterministicBackend('default.csv')
 *     test('my test', async ({ page }) => { ... })
 *   })
 */
export function useDeterministicBackend(tileOrderCsv: string): void {
  test.beforeAll(async () => {
    await startDeterministicBackend(tileOrderCsv)
  })

  test.afterAll(async () => {
    await stopDeterministicBackend()
  })
}
