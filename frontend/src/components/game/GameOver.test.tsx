import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GameOver } from './GameOver'
import { buildFinalScores } from '../../lib/finalScores'
import { snapshot } from '../../../tests/unit/fixtures/wire'

/** The standings the player page shows for a real finished game. */
function finished(name: 'game-over' | 'game-over-tie') {
  const view = snapshot(name)
  const state = view.player.find((m) => m.type === 'game_state')
  const over = view.player.find((m) => m.type === 'game_over')
  return { view, state, over, scores: buildFinalScores(state, over) }
}

function mount(name, props = {}) {
  const data = finished(name)
  const onPlayAgain = vi.fn()
  const onBackToLobby = vi.fn()
  render(
    <MemoryRouter>
      <GameOver
        scores={data.scores}
        myPlayerId={data.view.human}
        onPlayAgain={onPlayAgain}
        onBackToLobby={onBackToLobby}
        {...props}
      />
    </MemoryRouter>
  )
  return { ...data, onPlayAgain, onBackToLobby }
}

const money = (n) => `$${n.toLocaleString('en-US')}`
// Names come from the game state (the game_over message repeats names from the recording).
const nameOf = (data, id) => data.state.players[id].name

describe('GameOver on a real finished game', () => {
  it('names the single winner the server named; their total is in the standings, once', () => {
    const data = mount('game-over')
    const { over } = data
    expect(over.winners).toHaveLength(1)
    const winner = screen.getByTestId('winner-announcement')
    expect(winner).toHaveTextContent('WINNER')
    expect(winner).toHaveTextContent(nameOf(data, over.winner))
    // The amount is said once, in the winner's row of the standings (BL-017).
    const total = money(over.scores[over.winner].money)
    expect(winner).not.toHaveTextContent(total)
    expect(screen.getByTestId(`rank-${over.winner}`)).toHaveTextContent(total)
  })

  it('lists everybody best first, with ranks 1, 2, 3...', () => {
    const { over } = mount('game-over')
    const order = Object.entries(over.scores)
      .sort((a, b) => b[1].money - a[1].money)
      .map(([id]) => id)
    const rows = within(screen.getByTestId('rankings'))
      .getAllByTestId(/^rank-/)
      .map((r) => r.getAttribute('data-testid').replace('rank-', ''))
    expect(rows).toEqual(order)
    order.forEach((id, i) => {
      expect(screen.getByTestId(`rank-${id}`)).toHaveTextContent(`${i + 1}.`)
      expect(screen.getByTestId(`rank-${id}`)).toHaveTextContent(money(over.scores[id].money))
    })
  })

  it('a tie is announced as a tie, naming every winner the server named, with equal rank 1', () => {
    const data = mount('game-over-tie')
    const { over } = data
    expect(over.winners.length).toBeGreaterThan(1)
    const winner = screen.getByTestId('winner-announcement')
    expect(winner).toHaveTextContent('TIE GAME!')
    for (const id of over.winners) {
      expect(winner).toHaveTextContent(nameOf(data, id))
      expect(screen.getByTestId(`rank-${id}`)).toHaveTextContent('1.')
    }
    // Each winner's total is in their row.
    for (const id of over.winners) {
      expect(screen.getByTestId(`rank-${id}`)).toHaveTextContent(money(over.scores[id].money))
    }
    // The player after the tied pair is ranked below them, skipping the shared places.
    const rest = Object.keys(over.scores).filter((id) => !over.winners.includes(id))
    expect(screen.getByTestId(`rank-${rest[0]}`)).toHaveTextContent(`${over.winners.length + 1}.`)
  })

  it('the player sees their own breakdown: cash, bonuses and share sales add up to the total', () => {
    const { over, view } = mount('game-over')
    const mine = over.scores[view.human]
    const box = screen.getByTestId('breakdown')
    expect(screen.getByTestId('breakdown-bonuses')).toHaveTextContent(`+${money(mine.bonuses)}`)
    expect(screen.getByTestId('breakdown-stock-sales')).toHaveTextContent(
      `+${money(mine.stock_sales)}`
    )
    expect(box).toHaveTextContent(money(mine.money - mine.bonuses - mine.stock_sales))
    expect(box).toHaveTextContent(`TOTAL:${money(mine.money)}`)
  })

  it('when the server sent no breakdown nothing is invented: the totals are final cash, said once', () => {
    const data = finished('game-over')
    const scores = buildFinalScores(data.state, null)
    render(
      <MemoryRouter>
        <GameOver
          scores={scores}
          myPlayerId={data.view.human}
          onPlayAgain={() => {}}
          onBackToLobby={() => {}}
        />
      </MemoryRouter>
    )
    expect(screen.queryByTestId('breakdown-bonuses')).not.toBeInTheDocument()
    // No table that would repeat my standings row: one note says what the totals are.
    expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('totals-note')).toHaveTextContent(
      'Totals are final cash: bonuses and share sales are included.'
    )
    const mine = money(data.state.players[data.view.human].money)
    expect(screen.getByTestId('game-over').textContent.split(mine)).toHaveLength(2)
  })

  it('the spectator view shows every player in a full table, with the defunct-share note', () => {
    const data = mount('game-over', { variant: 'host', myPlayerId: undefined })
    expect(screen.queryByTestId('breakdown')).not.toBeInTheDocument()
    const table = screen.getByTestId('full-breakdown')
    for (const [id, s] of Object.entries(data.over.scores)) {
      expect(table).toHaveTextContent(nameOf(data, id))
      expect(table).toHaveTextContent(`+${money(s.bonuses)}`)
    }
    expect(table).toHaveTextContent('Shares of defunct hotel chains are worth $0')
  })

  it('PLAY AGAIN and BACK TO LOBBY do what they say', () => {
    const { onPlayAgain, onBackToLobby } = mount('game-over')
    fireEvent.click(screen.getByTestId('play-again'))
    fireEvent.click(screen.getByTestId('back-to-lobby'))
    expect(onPlayAgain).toHaveBeenCalledTimes(1)
    expect(onBackToLobby).toHaveBeenCalledTimes(1)
  })

  it('links to the transcript only when the game has one', () => {
    mount('game-over', { gameId: 'g-1 2' })
    expect(screen.getByTestId('view-transcript-link')).toHaveAttribute('href', '/games/g-1%202')
  })
})

describe('GameOver without a transcript', () => {
  it('shows no transcript link', () => {
    mount('game-over')
    expect(screen.queryByTestId('view-transcript-link')).not.toBeInTheDocument()
  })
})
