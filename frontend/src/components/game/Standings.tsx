import { FlashValue } from '../ui/FlashValue'
import { SeatKindBadge } from './SeatKindBadge'
import { AiThinking } from './AiThinking'
import { isAiThinking } from '../../lib/agents'
import { orderChainIds } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import type { GameStateMessage } from '../../types/api'
import styles from './Standings.module.css'

export interface StandingsProps {
  gameState: GameStateMessage
  /** The viewer's seat (player page): marked YOU. */
  myPlayerId?: string
  /** Row test id: `player-row` on the player page, `player-card` on the host scoreboard. */
  rowTestId?: string
  /** Test id of the list itself. */
  testId?: string
}

/**
 * Every player's cash, shares at current prices and net worth (all three from the server's
 * calculator, never added up here), their rank, holdings and whose turn it is. Rows are in seat
 * order so they do not jump around while the ranks change.
 */
export function Standings({
  gameState,
  myPlayerId,
  rowTestId = 'player-row',
  testId = 'players-panel',
}: StandingsProps) {
  const rules = useRules()
  const current = gameState.current_player
  const order = gameState.turn_order?.length ? gameState.turn_order : Object.keys(gameState.players)
  const tied = (rank: number | undefined) =>
    rank !== undefined && Object.values(gameState.players).filter((p) => p.rank === rank).length > 1

  return (
    <div className={styles.standings} data-testid={testId}>
      <div className={styles.head} aria-hidden="true">
        <span>#</span>
        <span>Player</span>
        <span className={styles.num}>Cash</span>
        <span className={styles.num}>{rules.theme.stock_label}</span>
        <span className={styles.num}>Net worth</span>
      </div>
      {order.map((id) => {
        const player = gameState.players[id]
        if (!player) return null
        const isTurn = id === current
        const held = orderChainIds(
          rules.rs,
          Object.keys(player.stocks).filter((c) => (player.stocks[c] ?? 0) > 0)
        )
        return (
          <div
            key={id}
            className={`${styles.row} ${isTurn ? styles.turn : ''} ${id === myPlayerId ? styles.me : ''}`}
            data-testid={rowTestId}
            data-player-id={id}
            data-current-turn={isTurn ? 'true' : undefined}
          >
            <span
              className={styles.rank}
              data-testid={`player-rank-${id}`}
              title={tied(player.rank) ? 'Tied on net worth' : 'Rank by net worth'}
            >
              {player.rank !== undefined ? `${tied(player.rank) ? '=' : ''}${player.rank}` : ''}
            </span>
            <span className={styles.name}>
              {isTurn && (
                <span className={styles.turnMarker} data-testid="turn-marker" title="On turn">
                  ▶
                </span>
              )}
              <span className={styles.nameText}>{player.name}</span>
              {id === myPlayerId && <span className={styles.you}>YOU</span>}
              <SeatKindBadge
                playerId={id}
                kind={player.kind}
                isBot={player.is_bot}
                agentLabel={player.agent_label}
                fallbacks={player.fallbacks}
              />
              {isAiThinking(gameState.awaiting, id) && <AiThinking />}
            </span>
            <FlashValue
              value={player.money}
              className={styles.num}
              data-testid={`player-cash-${id}`}
            >
              {rules.money(player.money)}
            </FlashValue>
            <span
              className={`${styles.num} ${styles.muted}`}
              data-testid={`player-stockvalue-${id}`}
            >
              {player.stock_value !== undefined ? rules.money(player.stock_value) : ''}
            </span>
            <FlashValue
              value={player.net_worth}
              className={`${styles.num} ${styles.worth}`}
              data-testid={`player-networth-${id}`}
            >
              {player.net_worth !== undefined ? rules.money(player.net_worth) : ''}
            </FlashValue>
            <span className={styles.stocks} data-testid="player-stocks">
              {held.map((chain) => (
                <span
                  key={chain}
                  className={styles.badge}
                  style={rules.style(chain)}
                  data-testid={`player-stock-${id}-${chain}`}
                  title={`${rules.name(chain)}: ${rules.shares(player.stocks[chain])}`}
                  data-abbr={rules.abbr(chain)}
                >
                  {player.stocks[chain]}
                </span>
              ))}
            </span>
          </div>
        )
      })}
    </div>
  )
}
