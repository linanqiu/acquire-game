import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Tile } from './Tile'
import { RulesetScope } from '../../ruleset/RulesetScope'
import { readableText } from '../../lib/ruleset'
import { ALL_RULESETS } from '../../../tests/unit/fixtures/rulesets'

describe('Tile', () => {
  it('a chain square shows the chain in the ruleset colour, by abbreviation (never colour alone)', () => {
    for (const [name, rs] of Object.entries(ALL_RULESETS)) {
      for (const c of rs.chains) {
        const { unmount } = render(
          <RulesetScope ruleset={rs}>
            <Tile coordinate="1A" chain={c.id} />
          </RulesetScope>
        )
        const tile = screen.getByTestId('tile-1A')
        expect(tile.style.getPropertyValue('--chain-bg'), `${name} ${c.id}`).toBe(c.color)
        expect(tile.style.getPropertyValue('--chain-fg')).toBe(readableText(c.color))
        expect(tile).toHaveTextContent(c.abbreviation)
        expect(tile).toHaveAttribute('title', `1A · ${c.name}`)
        unmount()
      }
    }
  })

  it('an empty square shows its coordinate, an orphan tile is not a chain', () => {
    const { unmount } = render(<Tile coordinate="3C" />)
    expect(screen.getByTestId('tile-3C')).toHaveTextContent('3C')
    expect(screen.getByTestId('tile-3C')).toHaveAttribute('data-chain', 'empty')
    unmount()
    render(<Tile coordinate="3C" chain="orphan" />)
    expect(screen.getByTestId('tile-3C')).toHaveAttribute('data-chain', 'orphan')
    expect(screen.getByTestId('tile-3C').style.getPropertyValue('--chain-bg')).toBe('')
  })

  it('a clickable tile is a button that works with the mouse, Enter and Space, and nothing else', () => {
    const onClick = vi.fn()
    render(<Tile coordinate="1A" onClick={onClick} />)
    const tile = screen.getByRole('button')
    fireEvent.click(tile)
    fireEvent.keyDown(tile, { key: 'Enter' })
    fireEvent.keyDown(tile, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(tile, { key: 'a' })
    fireEvent.keyDown(tile, { key: 'Tab' })
    expect(onClick).toHaveBeenCalledTimes(3)
    expect(tile).toHaveAttribute('tabindex', '0')
  })

  it('a locked (disabled) tile ignores clicks and is skipped by Tab', () => {
    const onClick = vi.fn()
    render(<Tile coordinate="1A" state="disabled" onClick={onClick} />)
    const tile = screen.getByTestId('tile-1A')
    fireEvent.click(tile)
    expect(onClick).not.toHaveBeenCalled()
    expect(tile).not.toHaveAttribute('tabindex')
  })

  it('a tile without a handler is not a button', () => {
    render(<Tile coordinate="1A" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('the label can be hidden (board squares)', () => {
    render(<Tile coordinate="1A" showLabel={false} />)
    expect(screen.getByTestId('tile-1A')).toBeEmptyDOMElement()
  })

  it('motion: nothing on first paint; a placed tile settles in; a chain change sweeps from the old colour', () => {
    const rs = ALL_RULESETS.default
    const [a, b] = rs.chains
    const at = (chain?: string) => (
      <RulesetScope ruleset={rs}>
        <Tile coordinate="4C" chain={chain} size="fluid" />
      </RulesetScope>
    )
    const { rerender } = render(at(a.id))
    const tile = screen.getByTestId('tile-4C')
    expect(tile).not.toHaveAttribute('data-anim')
    rerender(at(b.id))
    expect(tile).toHaveAttribute('data-anim', 'sweep')
    expect(tile.style.getPropertyValue('--chain-prev')).toBe(a.color)
    expect(tile.style.getPropertyValue('--sweep-col')).toBe('4')
    rerender(at(undefined))
    rerender(at('orphan'))
    expect(tile).toHaveAttribute('data-anim', 'place')
    // An animation that ends clears its marker.
    tile.dispatchEvent(new Event('animationend'))
    expect(tile).not.toHaveAttribute('data-anim')
  })
})
