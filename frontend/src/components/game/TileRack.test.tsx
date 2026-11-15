import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TileRack } from './TileRack'
import {
  transformHandToRackTiles,
  transformPlayabilityMap,
  unplayableReasons,
} from '../../utils/transforms'
import { playerState } from '../../../tests/unit/fixtures/wire'
import { DEFAULT_RS } from '../../../tests/unit/fixtures/rulesets'

/** The rack props the page builds from a real server state (same transforms as PlayerPage). */
function rackFrom(name: string) {
  const state = playerState(name)
  return transformHandToRackTiles(
    state.your_hand,
    transformPlayabilityMap(state.tile_playability),
    unplayableReasons(state.tile_playability, DEFAULT_RS)
  )
}

function mount(name: string, props = {}) {
  const onTileSelect = vi.fn()
  const tiles = rackFrom(name)
  render(<TileRack tiles={tiles} onTileSelect={onTileSelect} {...props} />)
  return { tiles, onTileSelect, tile: (c: string) => screen.getByTestId(`tile-${c}`) }
}

describe('TileRack with a real hand', () => {
  it('shows every tile of the hand and nothing else', () => {
    const { tiles } = mount('opening-place-tile')
    const rack = within(screen.getByTestId('tile-rack'))
    expect(tiles).toHaveLength(6)
    for (const t of tiles) expect(rack.getByText(t.coordinate)).toBeInTheDocument()
    expect(screen.queryByTestId('rack-notes')).not.toBeInTheDocument()
  })

  it('a playable tile can be picked', () => {
    const { tiles, onTileSelect, tile } = mount('opening-place-tile')
    fireEvent.click(tile(tiles[2].coordinate))
    expect(onTileSelect).toHaveBeenCalledWith(tiles[2].coordinate)
  })

  it('a permanently dead tile cannot be picked, is crossed out, and the rack says why', () => {
    const { tiles, onTileSelect, tile } = mount('dead-tile-in-hand')
    const dead = tiles.find((t) => t.playability === 'perm_unplayable')
    expect(dead.coordinate).toBe('4G')
    fireEvent.click(tile('4G'))
    expect(onTileSelect).not.toHaveBeenCalled()
    expect(tile('4G')).toHaveTextContent('✕')
    expect(screen.getByTestId('rack-note-4G')).toHaveTextContent(
      /can't be played: it would start an 8th hotel chain \(all 7 are already on the board\)/
    )
  })

  it('a tile that would merge two safe chains is locked for now (not dead) and explained', () => {
    const { tiles, onTileSelect, tile } = mount('safe-chain-on-board')
    const locked = tiles.find((t) => t.playability === 'temp_unplayable')
    expect(locked.coordinate).toBe('7D')
    fireEvent.click(tile('7D'))
    expect(onTileSelect).not.toHaveBeenCalled()
    expect(tile('7D')).toHaveTextContent('🔒')
    expect(screen.getByTestId('rack-note-7D')).toHaveTextContent(/merge two hotel chains/)
  })

  it('a tile that would cause a merger is flagged but still playable', () => {
    const { tiles, onTileSelect, tile } = mount('three-player-midgame')
    const merger = tiles.find((t) => t.playability === 'merger')
    expect(tile(merger.coordinate)).toHaveTextContent('!!')
    fireEvent.click(tile(merger.coordinate))
    expect(onTileSelect).toHaveBeenCalledWith(merger.coordinate)
  })

  it('when it is not my turn the whole rack is locked, but unplayable tiles are still explained', () => {
    const { tiles, onTileSelect, tile } = mount('dead-tile-in-hand', { disabled: true })
    for (const t of tiles) fireEvent.click(tile(t.coordinate))
    expect(onTileSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('rack-note-4G')).toBeInTheDocument()
  })
})
