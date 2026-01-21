import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  describe('rendering', () => {
    it('renders the label text', () => {
      render(<Badge label="SAFE" />)
      expect(screen.getByText('SAFE')).toBeInTheDocument()
    })

    it('has data-testid', () => {
      render(<Badge label="TEST" />)
      expect(screen.getByTestId('badge')).toBeInTheDocument()
    })
  })

  describe('variants', () => {
    it('applies default variant by default', () => {
      render(<Badge label="Default" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('default')
    })

    it('applies safe variant', () => {
      render(<Badge label="SAFE" variant="safe" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('safe')
    })

    it('applies warning variant', () => {
      render(<Badge label="Warning" variant="warning" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('warning')
    })

    it('applies danger variant', () => {
      render(<Badge label="Danger" variant="danger" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('danger')
    })

    it('applies info variant', () => {
      render(<Badge label="Info" variant="info" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('info')
    })
  })

  describe('sizes', () => {
    it('applies sm size by default', () => {
      render(<Badge label="Small" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('sm')
    })

    it('applies md size when specified', () => {
      render(<Badge label="Medium" size="md" />)
      const badge = screen.getByTestId('badge')
      expect(badge.className).toContain('md')
    })
  })
})
