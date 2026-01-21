import { Tile } from './Tile'
import styles from './TileRack.module.css'
import type { Coordinate, TileVisualState } from '../../types/game'

export type Playability = 'playable' | 'merger' | 'temp_unplayable' | 'perm_unplayable'

export interface RackTile {
  coordinate: Coordinate
  playability: Playability
}

export interface TileRackProps {
  tiles: RackTile[]
  selectedTile?: Coordinate
  onTileSelect: (coord: Coordinate) => void
  disabled?: boolean
}

function playabilityToState(playability: Playability, isSelected: boolean): TileVisualState {
  if (isSelected) return 'selected'
  switch (playability) {
    case 'playable':
      return 'default'
    case 'merger':
      return 'merger'
    case 'temp_unplayable':
      return 'disabled'
    case 'perm_unplayable':
      return 'dead'
  }
}

function isPlayable(playability: Playability): boolean {
  return playability === 'playable' || playability === 'merger'
}

export function TileRack({ tiles, selectedTile, onTileSelect, disabled = false }: TileRackProps) {
  return (
    <div className={styles.rack} data-testid="tile-rack">
      {tiles.map((tile) => {
        const isSelected = selectedTile === tile.coordinate
        const canInteract = !disabled && isPlayable(tile.playability)

        return (
          <Tile
            key={tile.coordinate}
            coordinate={tile.coordinate}
            state={playabilityToState(tile.playability, isSelected)}
            onClick={canInteract ? () => onTileSelect(tile.coordinate) : undefined}
            size="lg"
            showLabel={true}
          />
        )
      })}
    </div>
  )
}
