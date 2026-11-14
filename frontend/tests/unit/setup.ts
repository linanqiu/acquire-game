import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { useRulesetStore } from '../../src/ruleset/store'

// Cleanup after each test
afterEach(() => {
  cleanup()
  // The server ruleset is global app state: a test that sets one must not leak it.
  useRulesetStore.setState({ ruleset: null, status: 'idle', error: null })
})

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
