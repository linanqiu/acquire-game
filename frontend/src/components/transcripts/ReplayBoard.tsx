import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Board } from '../game/Board'
import { ChainMarker } from '../game/ChainMarker'
import { SeatKindBadge } from '../game/SeatKindBadge'
import type { Coordinate } from '../../types/game'
import { orderChainIds } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import { toTileStates } from '../../lib/replay'
import type { PublicState, TranscriptSeat } from '../../types/transcripts'
import styles from './ReplayBoard.module.css'

function useNarrow(maxWidth: number) {
  const query = `(max-width: ${maxWidth}px)`
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true
  )
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return narrow
}

interface ReplayBoardProps {
  /** Shown right under the board (the move of this step), before the chains and players. */
  afterBoard?: ReactNode
  state: PublicState | null
  seats: TranscriptSeat[]
  /** Tile placed by the current step, outlined on the board. */
  highlightTile?: string
  /** The seat whose decision is being shown. */
  activePlayerId?: string
}

export function ReplayBoard({
  state,
  seats,
  highlightTile,
  activePlayerId,
  afterBoard,
}: ReplayBoardProps) {
  const narrow = useNarrow(600)
  const rules = useRules()
  if (!state) {
    return (
      <div className={styles.empty} data-testid="replay-board-empty">
        No board state recorded yet.
      </div>
    )
  }
  const chains = orderChainIds(
    rules.rs,
    Object.keys(state.chains ?? {}).filter((c) => state.chains[c]?.active)
  )
  const priceOf = (c: string) => state.chains?.[c]?.stock_price ?? 0
  return (
    <div className={styles.wrap} data-testid="replay-board">
      <div className={styles.boardBox}>
        <Board
          tiles={toTileStates(state)}
          size={narrow ? 'sm' : 'md'}
          highlightedTile={highlightTile as Coordinate | undefined}
        />
        <p className={styles.meta}>
          {state.tiles_remaining} tiles left in the bag · phase {state.phase.replace(/_/g, ' ')}
        </p>
        {afterBoard}
      </div>

      <div className={styles.side}>
        <section aria-label={rules.theme.chain_noun_plural}>
          <h4 className={styles.h4}>{rules.theme.chain_noun_plural.toUpperCase()}</h4>
          {chains.length === 0 ? (
            <p className={styles.muted}>No {rules.theme.chain_noun_plural} on the board yet.</p>
          ) : (
            <table className={styles.table} data-testid="chain-table">
              <tbody>
                {chains.map((c) => {
                  const info = state.chains[c]
                  return (
                    <tr key={c}>
                      <td>
                        <ChainMarker chain={c} variant="compact" safe={info.safe} />
                      </td>
                      <td className={styles.num}>{info.size} tiles</td>
                      <td className={styles.num}>{rules.money(info.stock_price)}</td>
                      <td
                        className={styles.num}
                        title={`${rules.theme.share_noun_plural} left in the bank`}
                      >
                        [{info.available_stocks}]
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        <section aria-label="Players">
          <h4 className={styles.h4}>PLAYERS</h4>
          <ul className={styles.players} data-testid="player-list">
            {state.players.map((p) => {
              const seat = seats.find((s) => s.player_id === p.player_id)
              const holdings = orderChainIds(
                rules.rs,
                Object.keys(p.stocks ?? {}).filter((c) => (p.stocks?.[c] ?? 0) > 0)
              )
              const worth =
                p.money + holdings.reduce((n, c) => n + (p.stocks[c] ?? 0) * priceOf(c), 0)
              const current = state.current_player === p.player_id
              return (
                <li
                  key={p.player_id}
                  className={`${styles.player} ${activePlayerId === p.player_id ? styles.active : ''}`}
                  data-testid={`replay-player-${p.player_id}`}
                >
                  <div className={styles.pHead}>
                    <span className={styles.pName}>
                      {current && (
                        <span className={styles.turnMark} title="Their turn">
                          ▶
                        </span>
                      )}
                      {p.name}
                    </span>
                    <SeatKindBadge
                      playerId={p.player_id}
                      kind={seat?.kind}
                      isBot={p.is_bot}
                      agentLabel={seat?.agent_label}
                      playerName={p.name}
                    />
                    <span className={styles.cash} data-testid={`cash-${p.player_id}`}>
                      {rules.money(p.money)}
                    </span>
                  </div>
                  <div className={styles.holdings}>
                    {holdings.length === 0 ? (
                      <span className={styles.muted}>no {rules.theme.share_noun_plural}</span>
                    ) : (
                      holdings.map((c) => (
                        <span
                          key={c}
                          className={styles.holding}
                          data-testid={`holding-${p.player_id}-${c}`}
                        >
                          <ChainMarker chain={c} variant="icon" />
                          {p.stocks[c]}
                        </span>
                      ))
                    )}
                    <span
                      className={styles.worth}
                      title={`Cash plus ${rules.theme.share_noun_plural} at current prices`}
                    >
                      worth {rules.money(worth)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
