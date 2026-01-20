import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { TokenSwatch } from './TokenSwatch'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('TokenSwatch', () => {
  beforeAll(() => {
    // Inject the tokens CSS into jsdom
    const tokensCSS = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf-8')
    const style = document.createElement('style')
    style.textContent = tokensCSS
    document.head.appendChild(style)
  })

  it('renders with design tokens', () => {
    render(<TokenSwatch />)
    expect(screen.getByTestId('token-swatch')).toBeInTheDocument()
  })

  it('displays all chain color swatches', () => {
    render(<TokenSwatch />)
    const chains = [
      'luxor',
      'tower',
      'american',
      'festival',
      'worldwide',
      'continental',
      'imperial',
    ]
    chains.forEach((chain) => {
      expect(screen.getByTestId(`chain-${chain}`)).toBeInTheDocument()
    })
  })

  it('applies CSS variables to root element', () => {
    render(<TokenSwatch />)
    const root = document.documentElement
    const style = getComputedStyle(root)

    // Verify key CSS variables are defined
    expect(style.getPropertyValue('--bg-primary').trim()).toBe('#1a1a2e')
    expect(style.getPropertyValue('--text-primary').trim()).toBe('#e8e8e8')
    expect(style.getPropertyValue('--space-4').trim()).toBe('16px')
  })

  it('applies chain colors as CSS variables', () => {
    render(<TokenSwatch />)
    const root = document.documentElement
    const style = getComputedStyle(root)

    expect(style.getPropertyValue('--chain-luxor').trim()).toBe('#c9a227')
    expect(style.getPropertyValue('--chain-imperial').trim()).toBe('#3d5e8a')
  })
})
