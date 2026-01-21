import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MergerDisposition, type MergerDispositionProps } from './MergerDisposition'

describe('MergerDisposition', () => {
  const defaultProps: MergerDispositionProps = {
    defunctChain: 'Luxor',
    survivorChain: 'American',
    sharesOwned: 6,
    defunctPrice: 500,
    survivorStockAvailable: 10,
    onConfirm: vi.fn(),
  }

  describe('rendering', () => {
    it('displays defunct chain info', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText(/You have:/)).toBeInTheDocument()
      // Check for the share count display within the info section
      const infoText = screen.getByText(/You have:/)
      expect(infoText.parentElement).toHaveTextContent('6')
      expect(infoText.parentElement).toHaveTextContent('shares')
    })

    it('displays defunct chain price', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText(/Price at merger:/)).toBeInTheDocument()
      expect(screen.getByText('$500')).toBeInTheDocument()
    })

    it('displays survivor stock availability', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText(/stock available:/)).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('displays card title with defunct chain name', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText('DISPOSE OF YOUR LUXOR STOCK')).toBeInTheDocument()
    })

    it('displays SELL slider', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText('SELL to bank')).toBeInTheDocument()
    })

    it('displays TRADE slider', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText('TRADE 2:1 for AMERICAN')).toBeInTheDocument()
    })

    it('displays HOLD section', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByText('HOLD (keep for re-founding)')).toBeInTheDocument()
    })

    it('displays confirm button', () => {
      render(<MergerDisposition {...defaultProps} />)

      expect(screen.getByTestId('confirm-disposition')).toHaveTextContent('CONFIRM DISPOSITION')
    })
  })

  describe('initial state', () => {
    it('starts with all shares held', () => {
      render(<MergerDisposition {...defaultProps} />)

      const holdDisplay = screen.getByTestId('hold-display')
      expect(holdDisplay).toHaveTextContent('6 shares')
    })

    it('starts with zero sell and trade', () => {
      render(<MergerDisposition {...defaultProps} />)

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('SELL 0')
      expect(summary).toHaveTextContent('TRADE 0')
      expect(summary).toHaveTextContent('HOLD 6')
    })
  })

  describe('sell slider', () => {
    it('updates sell count when slider changes', () => {
      render(<MergerDisposition {...defaultProps} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      fireEvent.change(sellSlider, { target: { value: '3' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('SELL 3')
      expect(summary).toHaveTextContent('+$1,500') // 3 * 500
    })

    it('calculates cash from selling correctly', () => {
      render(<MergerDisposition {...defaultProps} defunctPrice={800} sharesOwned={10} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      fireEvent.change(sellSlider, { target: { value: '5' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('+$4,000') // 5 * 800
    })

    it('reduces hold count when selling', () => {
      render(<MergerDisposition {...defaultProps} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      fireEvent.change(sellSlider, { target: { value: '4' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('HOLD 2') // 6 - 4 = 2
    })
  })

  describe('trade slider', () => {
    it('updates trade count when slider changes', () => {
      render(<MergerDisposition {...defaultProps} />)

      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      fireEvent.change(tradeSlider, { target: { value: '4' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('TRADE 4')
    })

    it('enforces even numbers for trade (step=2)', () => {
      render(<MergerDisposition {...defaultProps} />)

      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      // Even if we try to set an odd value, it should round down to even
      fireEvent.change(tradeSlider, { target: { value: '3' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('TRADE 2') // Rounded down to 2
    })

    it('calculates shares from trading correctly (2:1 ratio)', () => {
      render(<MergerDisposition {...defaultProps} />)

      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      fireEvent.change(tradeSlider, { target: { value: '6' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('+3 AMERICAN') // 6 / 2 = 3
    })

    it('is disabled when survivor has no stock', () => {
      render(<MergerDisposition {...defaultProps} survivorStockAvailable={0} />)

      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      expect(tradeSlider).toBeDisabled()
    })
  })

  describe('hold calculation', () => {
    it('calculates hold as shares - sell - trade', () => {
      render(<MergerDisposition {...defaultProps} sharesOwned={10} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')

      fireEvent.change(sellSlider, { target: { value: '3' } })
      fireEvent.change(tradeSlider, { target: { value: '4' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('HOLD 3') // 10 - 3 - 4 = 3
    })

    it('adjusts trade when sell increases past available shares', () => {
      render(<MergerDisposition {...defaultProps} sharesOwned={6} />)

      // First set trade to 4
      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      fireEvent.change(tradeSlider, { target: { value: '4' } })

      // Then increase sell to 5, which leaves only 1 share
      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      fireEvent.change(sellSlider, { target: { value: '5' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('SELL 5')
      expect(summary).toHaveTextContent('TRADE 0') // Adjusted down since only 1 share left
      expect(summary).toHaveTextContent('HOLD 1')
    })
  })

  describe('confirm action', () => {
    it('calls onConfirm with sell, trade, hold values', () => {
      const onConfirm = vi.fn()
      render(<MergerDisposition {...defaultProps} sharesOwned={10} onConfirm={onConfirm} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')

      fireEvent.change(sellSlider, { target: { value: '3' } })
      fireEvent.change(tradeSlider, { target: { value: '4' } })

      fireEvent.click(screen.getByTestId('confirm-disposition'))

      expect(onConfirm).toHaveBeenCalledWith(3, 4, 3) // sell, trade, hold
    })

    it('calls onConfirm with initial values (all hold)', () => {
      const onConfirm = vi.fn()
      render(<MergerDisposition {...defaultProps} sharesOwned={5} onConfirm={onConfirm} />)

      fireEvent.click(screen.getByTestId('confirm-disposition'))

      expect(onConfirm).toHaveBeenCalledWith(0, 0, 5) // All held
    })
  })

  describe('edge cases', () => {
    it('handles single share', () => {
      render(<MergerDisposition {...defaultProps} sharesOwned={1} />)

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('HOLD 1')

      // Trading should be limited (can't trade 1 share at 2:1)
      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      expect(tradeSlider).toHaveAttribute('max', '0')
    })

    it('handles maximum survivor stock constraint', () => {
      // Only 2 survivor stocks available means max trade is 4 shares
      render(<MergerDisposition {...defaultProps} sharesOwned={10} survivorStockAvailable={2} />)

      const tradeSlider = screen.getByTestId('slider-trade-2:1-for-american')
      expect(tradeSlider).toHaveAttribute('max', '4') // 2 * 2 = 4
    })

    it('formats large numbers with commas', () => {
      render(<MergerDisposition {...defaultProps} defunctPrice={1200} sharesOwned={25} />)

      const sellSlider = screen.getByTestId('slider-sell-to-bank')
      fireEvent.change(sellSlider, { target: { value: '25' } })

      const summary = screen.getByTestId('disposition-summary')
      expect(summary).toHaveTextContent('+$30,000')
    })
  })
})
