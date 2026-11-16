import { Button } from '../../components/ui/Button'
import { AddAiControl } from '../../components/game/AddAiControl'
import { SeatKindBadge } from '../../components/game/SeatKindBadge'
import { RemoveSeatButton } from '../../components/game/RemoveSeatButton'
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

/** The player page before the game: who is seated; the host can add/remove AI seats and start. */
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
  return (
    <div className={styles.lobbyContent}>
      <h2 className={styles.lobbyTitle}>WAITING FOR PLAYERS</h2>
      <p className={styles.roomInfo}>
        Room Code: <span className={styles.roomCode}>{room}</span>
      </p>
      <div className={styles.playerList}>
        {players.map((p) => (
          <div
            key={p.player_id}
            className={styles.lobbyPlayer}
            data-testid={`lobby-player-${p.player_id}`}
          >
            <span>{p.name}</span>
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
      </div>
      <p className={styles.playerCount}>
        {players.length}/{maxPlayers} players
      </p>
      {isHost ? (
        <>
          <div className={styles.hostActions}>
            <AddAiControl room={room} disabled={players.length >= maxPlayers || loading} />
            <Button
              variant="accent"
              onClick={onStart}
              disabled={!canStart || loading}
              loading={loading}
            >
              START GAME
            </Button>
          </div>
          <p className={styles.waitingText} data-testid="start-hint">
            {startHint(players.length, minPlayers)}
          </p>
        </>
      ) : (
        <p className={styles.waitingText}>Waiting for host to start...</p>
      )}
    </div>
  )
}
