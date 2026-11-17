import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('marks whose move the phase line announces, and nothing outside a turn', () => {
    const { rerender } = render(
      <PageShell phase="PLACE A TILE" turn="mine">
        <p>x</p>
      </PageShell>
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-turn', 'mine')
    rerender(
      <PageShell phase="BOB'S TURN" turn="other">
        <p>x</p>
      </PageShell>
    )
    expect(screen.getByRole('status')).toHaveAttribute('data-turn', 'other')
    rerender(
      <PageShell phase="GAME OVER">
        <p>x</p>
      </PageShell>
    )
    expect(screen.getByRole('status')).not.toHaveAttribute('data-turn')
  })

  it('the "?" of the phase bar opens and closes the help, outside the announced status (BL-014)', () => {
    render(
      <PageShell phase="PLACE A TILE" turn="mine" help={<p>How to place</p>} helpFresh>
        <p>board</p>
      </PageShell>
    )
    const help = screen.getByRole('button', { name: 'How this works' })
    // The status region is only the phase text: opening the help announces nothing new.
    expect(screen.getByRole('status')).toHaveTextContent(/^PLACE A TILE$/)
    expect(screen.getByRole('status')).not.toContainElement(help)
    expect(help).toHaveAttribute('aria-expanded', 'false')
    expect(help).toHaveAttribute('data-fresh', 'true')
    expect(screen.queryByText('How to place')).not.toBeInTheDocument()
    fireEvent.click(help)
    expect(help).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'How this works' })).toHaveTextContent('How to place')
    // A press anywhere else closes it; so does the "?" itself, and Escape.
    fireEvent.pointerDown(screen.getByText('board'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(help)
    fireEvent.click(help)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(help)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('there is no "?" without help to show', () => {
    render(
      <PageShell phase="GAME OVER">
        <p>scores</p>
      </PageShell>
    )
    expect(screen.queryByTestId('phase-help')).not.toBeInTheDocument()
  })

  it('the phase bar is the way to a waiting move: one button, named for the phase and where it leads (BL-017)', () => {
    let opened = 0
    const { rerender } = render(
      <PageShell
        phase="BUY STOCKS"
        turn="mine"
        phaseLink={{ label: 'Board', onOpen: () => (opened += 1) }}
      >
        <p>chat</p>
      </PageShell>
    )
    const status = screen.getByRole('status')
    const link = screen.getByRole('button', { name: 'BUY STOCKS. Go to Board' })
    expect(status).toContainElement(link)
    expect(status).toHaveAttribute('data-turn', 'mine')
    expect(link).toHaveAttribute('data-go', 'Board')
    // The announced text is the phase alone.
    expect(status).toHaveTextContent(/^BUY STOCKS$/)
    fireEvent.click(link)
    expect(opened).toBe(1)
    // Without a link the bar is text again.
    rerender(
      <PageShell phase="BUY STOCKS" turn="mine">
        <p>board</p>
      </PageShell>
    )
    expect(screen.queryByTestId('phase-link')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^BUY STOCKS$/)
  })
})
