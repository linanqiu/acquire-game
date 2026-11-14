import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Header } from './Header'
import { serverRuleset } from '../../../tests/unit/fixtures/wire'

describe('Header', () => {
  it.each([
    ['classic', 'ACQUIRE'],
    ['valley', 'ACQUIHIRE'],
    ['mini', 'HARBORLINE'],
  ])('%s: the game title, room, player, cash and tile pool the page passes in', (name, title) => {
    serverRuleset(name)
    render(<Header roomCode="WXYZ" cash={12500} playerName="Bob" tilePool={30} />)
    expect(screen.getByTestId('header-title')).toHaveTextContent(title)
    expect(screen.getByTestId('header-room')).toHaveTextContent('WXYZ')
    expect(screen.getByTestId('header-name')).toHaveTextContent('Bob')
    expect(screen.getByTestId('header-cash')).toHaveTextContent('$12,500')
    expect(screen.getByTestId('header-tile-pool')).toHaveTextContent('[30]')
  })

  it('shows only what it is given, and says EMPTY for an empty bag; zero cash still shows', () => {
    const { rerender } = render(<Header />)
    for (const id of ['header-room', 'header-name', 'header-cash', 'header-tile-pool']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
    rerender(<Header cash={0} tilePool="EMPTY" />)
    expect(screen.getByTestId('header-cash')).toHaveTextContent('$0')
    expect(screen.getByTestId('header-tile-pool')).toHaveTextContent('[EMPTY]')
  })
})
