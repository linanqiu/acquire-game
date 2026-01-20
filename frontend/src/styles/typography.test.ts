import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const typographyCSS = readFileSync(resolve(__dirname, './typography.css'), 'utf-8')

describe('Typography System', () => {
  describe('Google Fonts Import', () => {
    it('imports IBM Plex Mono from Google Fonts', () => {
      expect(typographyCSS).toContain(
        "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono"
      )
    })

    it('imports required font weights (400, 500, 700)', () => {
      expect(typographyCSS).toContain('wght@400')
      expect(typographyCSS).toContain('500')
      expect(typographyCSS).toContain('700')
    })
  })

  describe('Base Body Styles', () => {
    it('applies font-primary to body', () => {
      expect(typographyCSS).toContain('font-family: var(--font-primary)')
    })

    it('applies text-md as default body font size', () => {
      expect(typographyCSS).toContain('font-size: var(--text-md)')
    })

    it('applies font-normal as default weight', () => {
      expect(typographyCSS).toContain('font-weight: var(--font-normal)')
    })

    it('applies line-height-normal to body', () => {
      expect(typographyCSS).toContain('line-height: var(--line-height-normal)')
    })

    it('applies text-primary color to body', () => {
      expect(typographyCSS).toContain('color: var(--text-primary)')
    })

    it('applies bg-primary to body', () => {
      expect(typographyCSS).toContain('background-color: var(--bg-primary)')
    })

    it('enables font smoothing', () => {
      expect(typographyCSS).toContain('-webkit-font-smoothing: antialiased')
      expect(typographyCSS).toContain('-moz-osx-font-smoothing: grayscale')
    })
  })

  describe('Heading Styles', () => {
    it('defines h1 with text-xl size', () => {
      expect(typographyCSS).toMatch(/h1[^{]*\{[^}]*font-size: var\(--text-xl\)/)
    })

    it('defines h2 with text-lg size', () => {
      expect(typographyCSS).toMatch(/h2[^{]*\{[^}]*font-size: var\(--text-lg\)/)
    })

    it('defines h3 with text-md size', () => {
      expect(typographyCSS).toMatch(/h3[^{]*\{[^}]*font-size: var\(--text-md\)/)
    })
  })

  describe('Text Size Utility Classes', () => {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl']

    sizes.forEach((size) => {
      it(`defines .text-${size} class`, () => {
        expect(typographyCSS).toContain(`.text-${size}`)
        expect(typographyCSS).toContain(`font-size: var(--text-${size})`)
      })
    })
  })

  describe('Font Weight Utility Classes', () => {
    it('defines .font-normal class', () => {
      expect(typographyCSS).toContain('.font-normal')
      expect(typographyCSS).toContain('font-weight: var(--font-normal)')
    })

    it('defines .font-medium class', () => {
      expect(typographyCSS).toContain('.font-medium')
      expect(typographyCSS).toContain('font-weight: var(--font-medium)')
    })

    it('defines .font-bold class', () => {
      expect(typographyCSS).toContain('.font-bold')
      expect(typographyCSS).toContain('font-weight: var(--font-bold)')
    })
  })

  describe('Line Height Utility Classes', () => {
    it('defines .leading-tight class', () => {
      expect(typographyCSS).toContain('.leading-tight')
      expect(typographyCSS).toContain('line-height: var(--line-height-tight)')
    })

    it('defines .leading-normal class', () => {
      expect(typographyCSS).toContain('.leading-normal')
      expect(typographyCSS).toContain('line-height: var(--line-height-normal)')
    })

    it('defines .leading-relaxed class', () => {
      expect(typographyCSS).toContain('.leading-relaxed')
      expect(typographyCSS).toContain('line-height: var(--line-height-relaxed)')
    })
  })

  describe('Text Color Utility Classes', () => {
    const colors = ['primary', 'secondary', 'accent', 'negative', 'positive']

    colors.forEach((color) => {
      it(`defines .text-${color} class`, () => {
        expect(typographyCSS).toContain(`.text-${color}`)
        expect(typographyCSS).toContain(`color: var(--text-${color})`)
      })
    })
  })

  describe('Tabular Numbers', () => {
    it('defines .tabular-nums class', () => {
      expect(typographyCSS).toContain('.tabular-nums')
      expect(typographyCSS).toContain('font-variant-numeric: tabular-nums')
    })

    it('defines .money class with tabular nums', () => {
      expect(typographyCSS).toContain('.money')
    })

    it('defines .money-positive class', () => {
      expect(typographyCSS).toContain('.money-positive')
      expect(typographyCSS).toMatch(/\.money-positive[^}]*color: var\(--text-positive\)/)
    })

    it('defines .money-negative class', () => {
      expect(typographyCSS).toContain('.money-negative')
      expect(typographyCSS).toMatch(/\.money-negative[^}]*color: var\(--text-negative\)/)
    })
  })

  describe('Text Alignment Utilities', () => {
    it('defines .text-left class', () => {
      expect(typographyCSS).toContain('.text-left')
      expect(typographyCSS).toContain('text-align: left')
    })

    it('defines .text-center class', () => {
      expect(typographyCSS).toContain('.text-center')
      expect(typographyCSS).toContain('text-align: center')
    })

    it('defines .text-right class', () => {
      expect(typographyCSS).toContain('.text-right')
      expect(typographyCSS).toContain('text-align: right')
    })
  })

  describe('Additional Text Utilities', () => {
    it('defines .text-nowrap class', () => {
      expect(typographyCSS).toContain('.text-nowrap')
      expect(typographyCSS).toContain('white-space: nowrap')
    })

    it('defines .text-truncate class', () => {
      expect(typographyCSS).toContain('.text-truncate')
      expect(typographyCSS).toContain('text-overflow: ellipsis')
    })

    it('defines .text-uppercase class', () => {
      expect(typographyCSS).toContain('.text-uppercase')
      expect(typographyCSS).toContain('text-transform: uppercase')
    })
  })
})
