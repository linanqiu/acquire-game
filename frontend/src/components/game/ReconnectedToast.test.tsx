import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ReconnectedToast } from './ReconnectedToast'

describe('ReconnectedToast', () => {
  it('welcomes the player back with where the game stands, and CONTINUE PLAYING dismisses it', () => {
    const onContinue = vi.fn()
    render(
      <ReconnectedToast
        playerName="Alice"
        currentTurn="Bob"
        phase="Buy Stocks"
        cash={12500}
        stockCount={12}
        tileCount={5}
        onContinue={onContinue}
      />
    )
    const toast = screen.getByTestId('reconnected-toast')
    expect(toast).toHaveTextContent('Welcome back, Alice!')
    expect(toast).toHaveTextContent('Bob (Buy Stocks)')
    expect(toast).toHaveTextContent('$12,500')
    expect(toast).toHaveTextContent('12 total')
    expect(toast).toHaveTextContent('5 in hand')
    fireEvent.click(screen.getByTestId('continue-playing'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('a player holding nothing still sees zeros, not blanks', () => {
    render(
      <ReconnectedToast
        playerName="Alice"
        currentTurn="Alice"
        phase="Place a tile"
        cash={0}
        stockCount={0}
        tileCount={0}
        onContinue={() => {}}
      />
    )
    const toast = screen.getByTestId('reconnected-toast')
    expect(toast).toHaveTextContent('$0')
    expect(toast).toHaveTextContent('0 total')
    expect(toast).toHaveTextContent('0 in hand')
  })
})
