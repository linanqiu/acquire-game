import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../styles/colors.css'

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
        <div className="bg-luxor" data-testid="bg-luxor">
          Chain
        </div>
      </>
    )

    expect(screen.getByTestId('bg-primary')).toHaveClass('bg-primary')
    expect(screen.getByTestId('text-positive')).toHaveClass('text-positive')
    expect(screen.getByTestId('bg-luxor')).toHaveClass('bg-luxor')
  })

  it('all chain background color utilities exist', () => {
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
      render(<div className={`bg-${chain}`} data-testid={`bg-${chain}`} />)
      expect(screen.getByTestId(`bg-${chain}`)).toHaveClass(`bg-${chain}`)
    })
  })

  it('all chain text color utilities exist', () => {
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
      render(<div className={`text-${chain}`} data-testid={`text-${chain}`} />)
      expect(screen.getByTestId(`text-${chain}`)).toHaveClass(`text-${chain}`)
    })
  })

  it('all chain border utilities exist', () => {
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
      render(<div className={`border-${chain}`} data-testid={`border-${chain}`} />)
      expect(screen.getByTestId(`border-${chain}`)).toHaveClass(`border-${chain}`)
    })
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
