import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SeatKindBadge } from './SeatKindBadge'
import { describeSeat } from '../../lib/agents'
import { playedGame } from '../../../tests/unit/fixtures/wire'

describe('describeSeat', () => {
  it('names the kind and, for an LLM seat, the model', () => {
    expect(describeSeat({ kind: 'llm', agent_label: 'Claude Haiku 5.5' })).toEqual({
      kind: 'llm',
      headline: 'AI player · Claude Haiku 5.5',
      detail: 'Reads the table chat',
      label: 'AI player, Claude Haiku 5.5',
    })
    expect(describeSeat({ kind: 'bot', agent_label: null })).toMatchObject({
      headline: 'Rules-based bot · does not chat',
      label: 'Rules-based bot',
    })
    expect(describeSeat({ is_bot: true }).kind).toBe('bot')
    expect(describeSeat({ kind: 'scripted', agent_label: 'Scripted' }).label).toBe(
      'Scripted test seat, Scripted'
    )
  })
})

describe('SeatKindBadge', () => {
  it('is a button whose accessible name says the kind and model, without opening it', () => {
    render(
      <>
        <SeatKindBadge playerId="a" kind="llm" agentLabel="Kimi K3" playerName="Lady Ledger" />
        <SeatKindBadge playerId="b" kind="bot" playerName="Baron Brick" />
        <SeatKindBadge playerId="h" kind="human" playerName="Alice" />
      </>
    )
    const llm = screen.getByRole('button', { name: 'AI player, Kimi K3' })
    expect(llm).toHaveAttribute('data-testid', 'seat-kind-a')
    expect(llm).toHaveAttribute('data-kind', 'llm')
    expect(llm).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Rules-based bot' })).toHaveAttribute(
      'data-kind',
      'bot'
    )
    // Human seats get no badge; the model is never spelled out next to the name.
    expect(screen.queryByTestId('seat-kind-h')).not.toBeInTheDocument()
    expect(screen.queryByText('Kimi K3')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens a popover on click with the model and what the seat does; click outside closes it', () => {
    render(
      <div>
        <p>outside</p>
        <SeatKindBadge playerId="a" kind="llm" agentLabel="Kimi K3" playerName="Lady Ledger" />
        <SeatKindBadge playerId="b" kind="bot" playerName="Baron Brick" />
      </div>
    )
    const button = screen.getByTestId('seat-kind-a')
    fireEvent.click(button)
    const pop = screen.getByRole('dialog', { name: 'About Lady Ledger' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', pop.id)
    expect(pop).toHaveTextContent('Lady Ledger')
    expect(pop).toHaveTextContent('AI player · Kimi K3')
    expect(pop).toHaveTextContent('Reads the table chat')
    // A click inside the popover keeps it open; outside closes it.
    fireEvent.pointerDown(within(pop).getByText('Reads the table chat'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('outside'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveAttribute('aria-expanded', 'false')

    // Opening another badge: the first closes (its outside click), the second opens.
    fireEvent.click(button)
    const bot = screen.getByTestId('seat-kind-b')
    fireEvent.pointerDown(bot)
    fireEvent.click(bot)
    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toHaveTextContent('Rules-based bot · does not chat')
    // Clicking the badge again toggles it shut.
    fireEvent.click(bot)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('works from the keyboard: a real button (Enter and Space click it), Escape closes and keeps focus', () => {
    render(<SeatKindBadge playerId="a" kind="llm" agentLabel="Kimi K3" playerName="Lady Ledger" />)
    const button = screen.getByRole('button', { name: 'AI player, Kimi K3' })
    // A native <button type="button">: in the tab order, Enter/Space fire click (the browser
    // does that; the tier-3 screen test presses Enter for real).
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
    expect(button.tabIndex).toBe(0)
    button.focus()
    fireEvent.click(button)
    expect(screen.getByRole('dialog')).toHaveTextContent('Kimi K3')
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    // Escape from anywhere on the page closes it too.
    fireEvent.click(button)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('inside another control it is a plain icon with the same accessible name', () => {
    render(
      <button type="button">
        Lady Ledger{' '}
        <SeatKindBadge playerId="a" kind="llm" agentLabel="Kimi K3" interactive={false} />
      </button>
    )
    const icon = screen.getByRole('img', { name: 'AI player, Kimi K3' })
    expect(icon).toHaveAttribute('data-testid', 'seat-kind-a')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('keeps the BOT ASSIST marker next to the badge', () => {
    render(
      <SeatKindBadge
        playerId="a"
        kind="llm"
        agentLabel="Kimi K3"
        fallbacks={{ count: 2, last_reason: 'timeout' }}
      />
    )
    expect(screen.getByTestId('seat-fallback-a')).toHaveTextContent('BOT ASSIST ×2')
    expect(screen.getByRole('button', { name: 'AI player, Kimi K3' })).toBeInTheDocument()
  })

  it('real lobby seats from the server: the bot has a character name and a bot badge', () => {
    const [, bot] = playedGame('default').lobby.players
    render(
      <SeatKindBadge
        playerId={bot.player_id}
        kind={bot.kind}
        isBot={bot.is_bot}
        agentLabel={bot.agent_label}
        playerName={bot.name}
      />
    )
    expect(bot.name).not.toMatch(/^Bot \d/)
    fireEvent.click(screen.getByRole('button', { name: 'Rules-based bot' }))
    expect(screen.getByRole('dialog', { name: `About ${bot.name}` })).toHaveTextContent(
      'Rules-based bot · does not chat'
    )
  })
})
