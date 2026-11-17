import { Button } from '../../components/ui/Button'
import { AddAiControl } from '../../components/game/AddAiControl'
import { SeatKindBadge } from '../../components/game/SeatKindBadge'
import { RemoveSeatButton } from '../../components/game/RemoveSeatButton'
import { ShareRoom } from '../../components/game/ShareRoom'
import { resolveSeatKind } from '../../lib/agents'
import { startHint } from '../../lib/lobby'
import type { LobbySeat } from '../../types/api'
import styles from '../PlayerPage.module.css'

interface LobbyPanelProps {
  room: string
  players: LobbySeat[]
  isHost: boolean
  canStart: boolean
  minPlayers: number
  maxPlayers: number
  loading: boolean
  onStart: () => void
}

/**
 * The player page before the game (BL-018): the room code with an invite button, who is seated
 * (with the free seats as the list's last, quiet line), and for the host the AI seats and START
 * GAME. One column, the same width as the home page's.
 */
export function LobbyPanel({
  room,
  players,
  isHost,
  canStart,
  minPlayers,
  maxPlayers,
  loading,
  onStart,
}: LobbyPanelProps) {
  const free = maxPlayers - players.length
  return (
    <div className={styles.lobbyContent} data-testid="lobby">
      {/* What the room waits for is said once, in the phase bar (`lobbyPhaseText`). */}
      <ShareRoom room={room} />
      <div className={styles.playerList} role="list" aria-label="Players in the room">
        {players.map((p) => (
          <div
            key={p.player_id}
            className={styles.lobbyPlayer}
            role="listitem"
            data-testid={`lobby-player-${p.player_id}`}
          >
            <span className={styles.seatName}>{p.name}</span>
            <span className={styles.seatTags}>
              <SeatKindBadge
                playerId={p.player_id}
                kind={p.kind}
                isBot={p.is_bot}
                agentLabel={p.agent_label}
                playerName={p.name}
              />
              {isHost && resolveSeatKind(p) !== 'human' && (
                <RemoveSeatButton room={room} playerId={p.player_id} playerName={p.name} />
              )}
            </span>
          </div>
        ))}
        {/* The list shows who is in; its foot adds only what it cannot: the seats left. */}
        <p className={styles.playerCount} data-testid="seats-free">
          {free > 0 ? `${free} seat${free > 1 ? 's' : ''} free` : 'Table full'}
        </p>
      </div>
      {isHost && (
        <div className={styles.hostActions}>
          <AddAiControl room={room} disabled={players.length >= maxPlayers || loading} />
          <Button
            variant="accent"
            size="lg"
            fullWidth
            onClick={onStart}
            disabled={!canStart || loading}
            loading={loading}
            title={canStart ? undefined : startHint(players.length, minPlayers)}
          >
            START GAME
          </Button>
        </div>
      )}
    </div>
  )
}
