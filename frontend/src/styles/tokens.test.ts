import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const tokensCSS = readFileSync(resolve(__dirname, './tokens.css'), 'utf-8')

describe('Design Tokens', () => {
  describe('Background Colors', () => {
    it('defines all background color tokens', () => {
      expect(tokensCSS).toContain('--bg-primary:')
      expect(tokensCSS).toContain('--bg-secondary:')
      expect(tokensCSS).toContain('--bg-tertiary:')
      expect(tokensCSS).toContain('--border:')
    })

    it('has correct background color values', () => {
      expect(tokensCSS).toContain('--bg-primary: #1a1a2e')
      expect(tokensCSS).toContain('--bg-secondary: #16213e')
      expect(tokensCSS).toContain('--bg-tertiary: #0f0f1a')
      expect(tokensCSS).toContain('--border: #2a2a4a')
    })
  })

  describe('Text Colors', () => {
    it('defines all text color tokens', () => {
      expect(tokensCSS).toContain('--text-primary:')
      expect(tokensCSS).toContain('--text-secondary:')
      expect(tokensCSS).toContain('--text-accent:')
      expect(tokensCSS).toContain('--text-negative:')
      expect(tokensCSS).toContain('--text-positive:')
    })

    it('has correct text color values', () => {
      expect(tokensCSS).toContain('--text-primary: #e8e8e8')
      expect(tokensCSS).toContain('--text-secondary: #8888aa')
      expect(tokensCSS).toContain('--text-accent: #ffffff')
      expect(tokensCSS).toContain('--text-negative: #ff6b6b')
      expect(tokensCSS).toContain('--text-positive: #6bff8a')
    })
  })

  describe('Chain Colors', () => {
    const chains = [
      'luxor',
      'tower',
      'american',
      'festival',
      'worldwide',
      'continental',
      'imperial',
    ]

    it('defines all 7 chain color tokens', () => {
      chains.forEach((chain) => {
        expect(tokensCSS).toContain(`--chain-${chain}:`)
      })
    })

    it('has correct chain color values', () => {
      expect(tokensCSS).toContain('--chain-luxor: #c9a227')
      expect(tokensCSS).toContain('--chain-tower: #7a5c3d')
      expect(tokensCSS).toContain('--chain-american: #5e7a8a')
      expect(tokensCSS).toContain('--chain-festival: #8a5e7a')
      expect(tokensCSS).toContain('--chain-worldwide: #5e8a6a')
      expect(tokensCSS).toContain('--chain-continental: #8a3d3d')
      expect(tokensCSS).toContain('--chain-imperial: #3d5e8a')
    })
  })

  describe('Typography', () => {
    it('defines font family tokens', () => {
      expect(tokensCSS).toContain('--font-primary:')
      expect(tokensCSS).toContain('IBM Plex Mono')
    })

    it('defines type scale tokens', () => {
      expect(tokensCSS).toContain('--text-xl: 24px')
      expect(tokensCSS).toContain('--text-lg: 18px')
      expect(tokensCSS).toContain('--text-md: 14px')
      expect(tokensCSS).toContain('--text-sm: 12px')
      expect(tokensCSS).toContain('--text-xs: 10px')
    })

    it('defines font weight tokens', () => {
      expect(tokensCSS).toContain('--font-normal: 400')
      expect(tokensCSS).toContain('--font-medium: 500')
      expect(tokensCSS).toContain('--font-bold: 700')
    })
  })

  describe('Spacing', () => {
    it('defines spacing scale from space-1 to space-12', () => {
      const spacingValues = [1, 2, 3, 4, 5, 6, 8, 10, 12]
      spacingValues.forEach((n) => {
        expect(tokensCSS).toContain(`--space-${n}:`)
      })
    })

    it('has correct spacing values based on 4px base unit', () => {
      expect(tokensCSS).toContain('--space-1: 4px')
      expect(tokensCSS).toContain('--space-2: 8px')
      expect(tokensCSS).toContain('--space-3: 12px')
      expect(tokensCSS).toContain('--space-4: 16px')
      expect(tokensCSS).toContain('--space-5: 20px')
      expect(tokensCSS).toContain('--space-6: 24px')
      expect(tokensCSS).toContain('--space-8: 32px')
      expect(tokensCSS).toContain('--space-10: 40px')
      expect(tokensCSS).toContain('--space-12: 48px')
    })
  })

  describe('Borders', () => {
    it('defines border radius tokens', () => {
      expect(tokensCSS).toContain('--radius-sm: 2px')
      expect(tokensCSS).toContain('--radius-md: 4px')
      expect(tokensCSS).toContain('--radius-lg: 8px')
      expect(tokensCSS).toContain('--radius-full: 9999px')
    })

    it('defines border style tokens', () => {
      expect(tokensCSS).toContain('--border-width: 1px')
      expect(tokensCSS).toContain('--border-style: solid')
      expect(tokensCSS).toContain('--border-default:')
    })
  })

  describe('Shadows', () => {
    it('defines shadow tokens', () => {
      expect(tokensCSS).toContain('--shadow-sm:')
      expect(tokensCSS).toContain('--shadow-md:')
      expect(tokensCSS).toContain('--shadow-lg:')
    })
  })

  describe('Animation', () => {
    it('defines timing function tokens', () => {
      expect(tokensCSS).toContain('--ease-default:')
      expect(tokensCSS).toContain('--ease-in:')
      expect(tokensCSS).toContain('--ease-out:')
      expect(tokensCSS).toContain('--ease-bounce:')
    })

    it('defines duration tokens', () => {
      expect(tokensCSS).toContain('--duration-fast: 100ms')
      expect(tokensCSS).toContain('--duration-normal: 200ms')
      expect(tokensCSS).toContain('--duration-slow: 400ms')
      expect(tokensCSS).toContain('--duration-dramatic: 800ms')
    })
  })

  describe('Responsive Breakpoints', () => {
    it('defines breakpoint tokens', () => {
      expect(tokensCSS).toContain('--breakpoint-sm: 375px')
      expect(tokensCSS).toContain('--breakpoint-md: 768px')
      expect(tokensCSS).toContain('--breakpoint-lg: 1024px')
      expect(tokensCSS).toContain('--breakpoint-xl: 1280px')
    })
  })

  describe('CSS Structure', () => {
    it('scopes all variables to :root', () => {
      expect(tokensCSS).toContain(':root {')
    })
  })
})
