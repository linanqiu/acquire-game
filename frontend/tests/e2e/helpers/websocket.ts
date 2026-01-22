/**
 * E2E Test Helpers - WebSocket Operations
 *
 * Helper functions for WebSocket interactions during E2E tests.
 */

import type { Page } from '@playwright/test'

const WS_URL = 'ws://localhost:8000'

// Extend Window interface for test utilities
declare global {
  interface Window {
    __testWs: WebSocket
    __testMessages: unknown[]
  }
}

/**
 * Connect to WebSocket as a player.
 */
export async function connectWebSocket(
  page: Page,
  roomCode: string,
  playerId: string,
  token?: string
): Promise<void> {
  const wsUrl = token
    ? `${WS_URL}/ws/player/${roomCode}/${playerId}?token=${token}`
    : `${WS_URL}/ws/player/${roomCode}/${playerId}`

  await page.evaluate((url) => {
    return new Promise<void>((resolve, reject) => {
      window.__testMessages = []
      window.__testWs = new WebSocket(url)

      window.__testWs.onmessage = (e) => {
        window.__testMessages.push(JSON.parse(e.data))
      }

      window.__testWs.onopen = () => resolve()
      window.__testWs.onerror = (e) => reject(new Error(`WebSocket error: ${e}`))

      // Timeout after 5 seconds
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000)
    })
  }, wsUrl)
}

/**
 * Wait for a WebSocket message matching specified criteria.
 * Uses explicit match criteria instead of closures to avoid serialization issues.
 */
export interface MessageMatchCriteria {
  type?: string
  current_player?: string
  phase?: string
  boardHasTile?: string
}

export async function waitForMessage<T = unknown>(
  page: Page,
  criteria: MessageMatchCriteria,
  timeout = 5000
): Promise<T> {
  return page.evaluate(
    async ({ matchCriteria, ms }) => {
      const matchFn = (msg: Record<string, unknown>): boolean => {
        if (matchCriteria.type && msg.type !== matchCriteria.type) return false
        if (matchCriteria.current_player && msg.current_player !== matchCriteria.current_player)
          return false
        if (matchCriteria.phase && msg.phase !== matchCriteria.phase) return false
        if (matchCriteria.boardHasTile) {
          const board = msg.board as Record<string, unknown> | undefined
          if (!board || board[matchCriteria.boardHasTile] === undefined) return false
        }
        return true
      }

      return new Promise<unknown>((resolve, reject) => {
        // Check existing messages first
        const existing = window.__testMessages.find((m) => matchFn(m as Record<string, unknown>))
        if (existing) {
          resolve(existing)
          return
        }

        // Poll for new messages
        const interval = setInterval(() => {
          const msg = window.__testMessages.find((m) => matchFn(m as Record<string, unknown>))
          if (msg) {
            clearInterval(interval)
            resolve(msg)
          }
        }, 100)

        // Timeout
        setTimeout(() => {
          clearInterval(interval)
          reject(new Error(`Timeout waiting for message after ${ms}ms`))
        }, ms)
      })
    },
    { matchCriteria: criteria, ms: timeout }
  ) as Promise<T>
}

/**
 * Send an action via WebSocket.
 */
export async function sendAction(page: Page, action: unknown): Promise<void> {
  await page.evaluate((act) => {
    window.__testWs.send(JSON.stringify(act))
  }, action)
}

/**
 * Get all received WebSocket messages.
 */
export async function getMessages(page: Page): Promise<unknown[]> {
  return page.evaluate(() => window.__testMessages)
}

/**
 * Clear stored WebSocket messages.
 */
export async function clearMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__testMessages = []
  })
}

/**
 * Close WebSocket connection.
 */
export async function closeWebSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__testWs) {
      window.__testWs.close()
    }
  })
}
