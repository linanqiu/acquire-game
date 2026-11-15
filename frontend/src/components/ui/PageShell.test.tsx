import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageShell } from './PageShell'

describe('PageShell', () => {
  it('announces the phase banner politely to screen readers, and passes the header facts through', () => {
    render(
      <PageShell phase="PLACE A TILE" roomCode="ABCD" cash={6000} playerName="Alice" tilePool={80}>
        <p>board</p>
      </PageShell>
    )
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('PLACE A TILE')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('header-room')).toHaveTextContent('ABCD')
    expect(screen.getByTestId('header-cash')).toHaveTextContent('$6,000')
    expect(screen.getByTestId('header-tile-pool')).toHaveTextContent('[80]')
  })

  it('a page can bring its own header, or none; the banner only shows when given', () => {
    const { rerender } = render(
      <PageShell header={<header>Host header</header>}>
        <p>content</p>
      </PageShell>
    )
    expect(screen.getByText('Host header')).toBeInTheDocument()
    expect(screen.queryByTestId('header-title')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(
      <PageShell header={null}>
        <p>content</p>
      </PageShell>
    )
    expect(screen.queryByTestId('header-title')).not.toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
