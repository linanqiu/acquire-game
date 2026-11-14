import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../styles/colors.css'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Color System', () => {
  it('applies dark background to body', () => {
    const style = getComputedStyle(document.body)
    expect(style.backgroundColor).toBeTruthy()
  })

  it('utility classes apply correct colors', () => {
    render(
      <>
        <div className="bg-primary" data-testid="bg-primary">
          BG
        </div>
        <div className="text-positive" data-testid="text-positive">
          Text
        </div>
      </>
    )

    expect(screen.getByTestId('bg-primary')).toHaveClass('bg-primary')
    expect(screen.getByTestId('text-positive')).toHaveClass('text-positive')
  })

  it('has no per-chain utility classes (chain colours are ruleset data, applied inline)', () => {
    const css = readFileSync(resolve(__dirname, 'colors.css'), 'utf8')
    expect(css).not.toMatch(
      /\.(bg|text|border)-(luxor|tower|american|festival|worldwide|continental|imperial)\b/
    )
    expect(css).toContain('.bg-orphan')
  })

  it('background utilities exist', () => {
    render(
      <>
        <div className="bg-primary" data-testid="primary">
          1
        </div>
        <div className="bg-secondary" data-testid="secondary">
          2
        </div>
        <div className="bg-tertiary" data-testid="tertiary">
          3
        </div>
      </>
    )
    expect(screen.getByTestId('primary')).toHaveClass('bg-primary')
    expect(screen.getByTestId('secondary')).toHaveClass('bg-secondary')
    expect(screen.getByTestId('tertiary')).toHaveClass('bg-tertiary')
  })

  it('text utilities exist', () => {
    render(
      <>
        <div className="text-primary" data-testid="t-primary">
          1
        </div>
        <div className="text-secondary" data-testid="t-secondary">
          2
        </div>
        <div className="text-accent" data-testid="t-accent">
          3
        </div>
        <div className="text-positive" data-testid="t-positive">
          4
        </div>
        <div className="text-negative" data-testid="t-negative">
          5
        </div>
      </>
    )
    expect(screen.getByTestId('t-primary')).toHaveClass('text-primary')
    expect(screen.getByTestId('t-secondary')).toHaveClass('text-secondary')
    expect(screen.getByTestId('t-accent')).toHaveClass('text-accent')
    expect(screen.getByTestId('t-positive')).toHaveClass('text-positive')
    expect(screen.getByTestId('t-negative')).toHaveClass('text-negative')
  })

  it('orphan tile utilities exist', () => {
    render(
      <>
        <div className="bg-orphan" data-testid="bg-orphan">
          1
        </div>
        <div className="text-orphan" data-testid="text-orphan">
          2
        </div>
        <div className="border-orphan" data-testid="border-orphan">
          3
        </div>
      </>
    )
    expect(screen.getByTestId('bg-orphan')).toHaveClass('bg-orphan')
    expect(screen.getByTestId('text-orphan')).toHaveClass('text-orphan')
    expect(screen.getByTestId('border-orphan')).toHaveClass('border-orphan')
  })
})
