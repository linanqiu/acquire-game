import { Tile } from './Tile'
import styles from './TileRack.module.css'
import type { Coordinate, TileVisualState } from '../../types/game'

export type Playability = 'playable' | 'merger' | 'temp_unplayable' | 'perm_unplayable'

export interface RackTile {
  coordinate: Coordinate
  playability: Playability
  /** Why the tile cannot be played right now (shown under the rack for unplayable tiles). */
  reason?: string
}

export interface TileRackProps {
  tiles: RackTile[]
  selectedTile?: Coordinate
  onTileSelect: (coord: Coordinate) => void
  disabled?: boolean
  /** Show why tiles cannot be played under the rack (phones show them in the decision tab). */
  notes?: boolean
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

/** Why rack tiles cannot be played, one line per reason ("3F, 3I can't be played: ..."). */
export function RackNotes({ tiles }: { tiles: RackTile[] }) {
  const groups: Array<[string, Coordinate[]]> = []
  for (const t of tiles) {
    if (isPlayable(t.playability) || !t.reason) continue
    const group = groups.find(([reason]) => reason === t.reason)
    if (group) group[1].push(t.coordinate)
    else groups.push([t.reason, [t.coordinate]])
  }
  if (groups.length === 0) return null
  return (
    <ul className={styles.notes} data-testid="rack-notes">
      {groups.map(([reason, coords]) => (
        <li key={reason} data-testid="rack-note" data-tiles={coords.join(' ')}>
          <strong>{coords.join(', ')}</strong> can't be played: {reason}
        </li>
      ))}
    </ul>
  )
}

export function TileRack({
  tiles,
  selectedTile,
  onTileSelect,
  disabled = false,
  notes = true,
}: TileRackProps) {
  return (
    <>
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
      {notes && <RackNotes tiles={tiles} />}
    </>
  )
}
