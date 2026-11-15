import { SeatKindBadge } from '../../components/game/SeatKindBadge'
import { AiThinking } from '../../components/game/AiThinking'
import { isAiThinking } from '../../lib/agents'
import { orderChainIds } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import type { GameStateMessage } from '../../types/api'
import styles from '../PlayerPage.module.css'

interface PlayersPanelProps {
  gameState: GameStateMessage
  myPlayerId: string | undefined
}

/** Every player's cash and holdings, with whose turn it is and which AI is thinking. */
export function PlayersPanel({ gameState, myPlayerId }: PlayersPanelProps) {
  const rules = useRules()
  const currentTurnPlayerId = gameState.current_player
  return (
    <div className={styles.playersPanel} data-testid="players-panel">
      <h4 className={styles.playersPanelTitle}>PLAYERS</h4>
      {Object.entries(gameState.players).map(([id, player]) => (
        <div
          key={id}
          className={`${styles.playerRow} ${id === currentTurnPlayerId ? styles.activePlayer : ''}`}
          data-testid="player-row"
          data-player-id={id}
          data-current-turn={id === currentTurnPlayerId ? 'true' : undefined}
        >
          <span className={styles.playerName}>
            {player.name}
            {id === myPlayerId && <span className={styles.youBadge}>YOU</span>}
            <SeatKindBadge
              playerId={id}
              kind={player.kind}
              isBot={player.is_bot}
              agentLabel={player.agent_label}
              fallbacks={player.fallbacks}
            />
            {isAiThinking(gameState.awaiting, id) && <AiThinking />}
          </span>
          <span className={styles.playerCash} data-testid={`player-cash-${id}`}>
            {rules.money(player.money)}
          </span>
          <div className={styles.playerStocks}>
            {orderChainIds(
              rules.rs,
              Object.keys(player.stocks).filter((c) => (player.stocks[c] ?? 0) > 0)
            ).map((chain) => (
              <span
                key={chain}
                className={styles.stockBadge}
                style={rules.style(chain)}
                data-testid={`player-stock-${id}-${chain}`}
                title={`${rules.name(chain)}: ${rules.shares(player.stocks[chain])}`}
                data-abbr={rules.abbr(chain)}
              >
                {player.stocks[chain]}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
