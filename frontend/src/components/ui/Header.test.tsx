import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Header } from './Header'
import { serverRuleset } from '../../../tests/unit/fixtures/wire'
import { useRulesetStore } from '../../ruleset/store'

describe('Header', () => {
  it.each([
    ['default', 'Grand Hotels'],
    ['valley', 'Acquihire'],
    ['mini', 'Harborline'],
  ])(
    '%s: the brand (not the theme title), room, player, cash and tile pool the page passes in',
    (name, theme) => {
      serverRuleset(name)
      render(<Header roomCode="WXYZ" cash={12500} playerName="Bob" tilePool={30} />)
      expect(screen.getByTestId('header-title')).toHaveTextContent('BUYOUT')
      expect(screen.getByTestId('header-title')).not.toHaveTextContent(theme.toUpperCase())
      expect(screen.getByTestId('header-room')).toHaveTextContent('WXYZ')
      expect(screen.getByTestId('header-name')).toHaveTextContent('Bob')
      expect(screen.getByTestId('header-cash')).toHaveTextContent('$12,500')
      expect(screen.getByTestId('header-tile-pool')).toHaveTextContent('[30]')
    }
  )

  it("the brand is the server's (GAME_BRAND_NAME), whatever the ruleset", () => {
    serverRuleset('valley')
    useRulesetStore.getState().setBrand('Hotelier')
    render(<Header />)
    expect(screen.getByTestId('header-title')).toHaveTextContent('HOTELIER')
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

  it('in a game the header keeps its compact form with or without my numbers, so tabs do not move the page (BL-017)', () => {
    // The Board tab: my cash and worth are in the players table, the header has room and bag.
    const { rerender, container } = render(<Header inGame roomCode="WXYZ" tilePool={30} />)
    const header = container.querySelector('header')!
    expect(header).toHaveAttribute('data-numbers', 'true')
    expect(header).not.toHaveAttribute('data-mine')
    expect(screen.getByTestId('header-room')).toHaveTextContent('Room WXYZ')
    expect(screen.queryByTestId('header-cash')).not.toBeInTheDocument()
    expect(screen.queryByTestId('header-networth')).not.toBeInTheDocument()
    // Another tab: my numbers; the same compact form.
    rerender(<Header inGame roomCode="WXYZ" tilePool={30} cash={12500} netWorth={24600} rank={1} />)
    expect(header).toHaveAttribute('data-numbers', 'true')
    expect(header).toHaveAttribute('data-mine', 'true')
    expect(screen.getByTestId('header-cash')).toHaveTextContent('$12,500')
    expect(screen.getByTestId('header-networth')).toHaveTextContent('$24,600')
    expect(screen.getByTestId('header-rank')).toHaveTextContent('#1')
    expect(screen.getByTestId('header-tile-pool')).toHaveTextContent('[30]')
  })

  it("in a game the menu takes the wordmark's place: room and invite, theme, rules, the way home (BL-019)", () => {
    serverRuleset('default')
    render(
      <MemoryRouter>
        <Header inGame menuRoom="WXYZ" roomCode="WXYZ" tilePool={30} />
      </MemoryRouter>
    )
    // Nothing of it shows until asked: the header carries what changes.
    expect(screen.queryByTestId('header-menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('theme-toggle')).not.toBeInTheDocument()
    const button = screen.getByTestId('header-menu-button')
    expect(button).toHaveAccessibleName('Menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    const menu = screen.getByTestId('header-menu')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('menu-room-code')).toHaveTextContent('WXYZ')
    expect(screen.getByTestId('menu-share')).toHaveAttribute(
      'href',
      expect.stringContaining('code=WXYZ')
    )
    expect(screen.getByTestId('menu-theme-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('menu-rules')).toHaveTextContent('Rules in brief')
    expect(screen.getByTestId('menu-rules')).toHaveTextContent('trade 2:1')
    expect(screen.getByTestId('menu-leave')).toHaveAttribute('href', '/')
    expect(menu).toHaveAccessibleName('Menu')
    // Escape closes it and gives the focus back.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('header-menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })
})
