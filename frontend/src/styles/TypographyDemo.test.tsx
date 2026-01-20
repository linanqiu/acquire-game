import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load CSS files and inject them into the document
beforeAll(() => {
  const tokensCSS = readFileSync(resolve(__dirname, './tokens.css'), 'utf-8')
  const typographyCSS = readFileSync(resolve(__dirname, './typography.css'), 'utf-8')

  // Remove the @import statement (Google Fonts won't load in jsdom anyway)
  const typographyCSSWithoutImport = typographyCSS.replace(/@import url\([^)]+\);/g, '')

  const style = document.createElement('style')
  style.textContent = tokensCSS + typographyCSSWithoutImport
  document.head.appendChild(style)
})

// Note: jsdom doesn't fully resolve CSS custom properties, so we check for
// the var() references in computed styles. The CSS file content tests in
// typography.test.ts verify the correct token values are used.

describe('Typography Component Integration', () => {
  describe('Text Size Classes', () => {
    it('applies .text-xs class with font-size token', () => {
      render(
        <span className="text-xs" data-testid="text-xs">
          XS
        </span>
      )
      const el = screen.getByTestId('text-xs')
      expect(el).toHaveClass('text-xs')
      const style = getComputedStyle(el)
      // jsdom returns var() reference, not resolved value
      expect(style.fontSize).toMatch(/var\(--text-xs\)|10px/)
    })

    it('applies .text-sm class with font-size token', () => {
      render(
        <span className="text-sm" data-testid="text-sm">
          SM
        </span>
      )
      const el = screen.getByTestId('text-sm')
      const style = getComputedStyle(el)
      expect(style.fontSize).toMatch(/var\(--text-sm\)|12px/)
    })

    it('applies .text-md class with font-size token', () => {
      render(
        <span className="text-md" data-testid="text-md">
          MD
        </span>
      )
      const el = screen.getByTestId('text-md')
      const style = getComputedStyle(el)
      expect(style.fontSize).toMatch(/var\(--text-md\)|14px/)
    })

    it('applies .text-lg class with font-size token', () => {
      render(
        <span className="text-lg" data-testid="text-lg">
          LG
        </span>
      )
      const el = screen.getByTestId('text-lg')
      const style = getComputedStyle(el)
      expect(style.fontSize).toMatch(/var\(--text-lg\)|18px/)
    })

    it('applies .text-xl class with font-size token', () => {
      render(
        <span className="text-xl" data-testid="text-xl">
          XL
        </span>
      )
      const el = screen.getByTestId('text-xl')
      const style = getComputedStyle(el)
      expect(style.fontSize).toMatch(/var\(--text-xl\)|24px/)
    })
  })

  describe('Font Weight Classes', () => {
    it('applies .font-normal class with weight token', () => {
      render(
        <span className="font-normal" data-testid="font-normal">
          Normal
        </span>
      )
      const el = screen.getByTestId('font-normal')
      const style = getComputedStyle(el)
      expect(style.fontWeight).toMatch(/var\(--font-normal\)|400/)
    })

    it('applies .font-medium class with weight token', () => {
      render(
        <span className="font-medium" data-testid="font-medium">
          Medium
        </span>
      )
      const el = screen.getByTestId('font-medium')
      const style = getComputedStyle(el)
      expect(style.fontWeight).toMatch(/var\(--font-medium\)|500/)
    })

    it('applies .font-bold class with weight token', () => {
      render(
        <span className="font-bold" data-testid="font-bold">
          Bold
        </span>
      )
      const el = screen.getByTestId('font-bold')
      const style = getComputedStyle(el)
      expect(style.fontWeight).toMatch(/var\(--font-bold\)|700/)
    })
  })

  describe('Tabular Numbers', () => {
    it('applies .tabular-nums class', () => {
      render(
        <span className="tabular-nums" data-testid="tabular">
          1234
        </span>
      )
      const el = screen.getByTestId('tabular')
      expect(el).toHaveClass('tabular-nums')
      const style = getComputedStyle(el)
      expect(style.fontVariantNumeric).toBe('tabular-nums')
    })
  })

  describe('Text Alignment', () => {
    it('applies .text-center class', () => {
      render(
        <div className="text-center" data-testid="text-center">
          Center
        </div>
      )
      const el = screen.getByTestId('text-center')
      const style = getComputedStyle(el)
      expect(style.textAlign).toBe('center')
    })

    it('applies .text-right class', () => {
      render(
        <div className="text-right" data-testid="text-right">
          Right
        </div>
      )
      const el = screen.getByTestId('text-right')
      const style = getComputedStyle(el)
      expect(style.textAlign).toBe('right')
    })
  })

  describe('Text Utilities', () => {
    it('applies .text-truncate class', () => {
      render(
        <div className="text-truncate" data-testid="truncate">
          Truncated
        </div>
      )
      const el = screen.getByTestId('truncate')
      const style = getComputedStyle(el)
      expect(style.overflow).toBe('hidden')
      expect(style.textOverflow).toBe('ellipsis')
      expect(style.whiteSpace).toBe('nowrap')
    })

    it('applies .text-uppercase class', () => {
      render(
        <span className="text-uppercase" data-testid="uppercase">
          uppercase
        </span>
      )
      const el = screen.getByTestId('uppercase')
      const style = getComputedStyle(el)
      expect(style.textTransform).toBe('uppercase')
    })
  })

  describe('Combined Classes', () => {
    it('can combine multiple typography classes', () => {
      render(
        <span className="text-lg font-bold tabular-nums text-center" data-testid="combined">
          $1,234
        </span>
      )
      const el = screen.getByTestId('combined')
      expect(el).toHaveClass('text-lg')
      expect(el).toHaveClass('font-bold')
      expect(el).toHaveClass('tabular-nums')
      expect(el).toHaveClass('text-center')
      const style = getComputedStyle(el)
      // Check that CSS is applied (values may be var() or resolved)
      expect(style.fontSize).toMatch(/var\(--text-lg\)|18px/)
      expect(style.fontVariantNumeric).toBe('tabular-nums')
    })
  })
})
