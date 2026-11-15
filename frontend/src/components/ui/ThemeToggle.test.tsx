import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { THEME_KEY, applyStoredTheme, currentTheme, setTheme } from '../../lib/theme'

/** Pretend the system prefers `scheme`. */
function systemPrefers(scheme: 'light' | 'dark') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({
      matches: q.includes('light') ? scheme === 'light' : scheme === 'dark',
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
}

const root = () => document.documentElement

describe('light / dark theme', () => {
  beforeEach(() => {
    localStorage.clear()
    delete root().dataset.theme
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    delete root().dataset.theme
  })

  it('follows the system until the player picks, and remembers the pick', () => {
    systemPrefers('dark')
    applyStoredTheme()
    expect(root().dataset.theme).toBeUndefined()
    render(<ThemeToggle />)
    const toggle = screen.getByTestId('theme-toggle')
    expect(toggle).toHaveAttribute('data-theme-current', 'dark')
    expect(toggle).toHaveAccessibleName('Switch to light theme')

    fireEvent.click(toggle)
    expect(root().dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(toggle).toHaveAttribute('data-theme-current', 'light')
    expect(toggle).toHaveAccessibleName('Switch to dark theme')

    // Back to what the system prefers: the stored choice is cleared (follow the system again).
    fireEvent.click(toggle)
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(root().dataset.theme).toBeUndefined()
    expect(toggle).toHaveAttribute('data-theme-current', 'dark')
  })

  it('applies a remembered choice on load, whatever the system says', () => {
    systemPrefers('light')
    localStorage.setItem(THEME_KEY, 'dark')
    applyStoredTheme()
    expect(root().dataset.theme).toBe('dark')
    expect(currentTheme()).toBe('dark')
  })

  it('ignores junk in storage and survives storage that throws', () => {
    systemPrefers('light')
    localStorage.setItem(THEME_KEY, 'purple')
    applyStoredTheme()
    expect(root().dataset.theme).toBeUndefined()
    expect(currentTheme()).toBe('light')

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    act(() => setTheme('dark'))
    expect(root().dataset.theme).toBe('dark')
    expect(currentTheme()).toBe('dark')
    spy.mockRestore()
  })
})
