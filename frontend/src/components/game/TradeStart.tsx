import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { Hint } from '../ui/Hint'
import { shortNames } from '../../lib/shortNames'
import { useRules } from '../../ruleset/useRules'
import type { ChainId, GameStateMessage } from '../../types/api'
import styles from './TradeStart.module.css'

export interface TradeStartProps {
  gameState: GameStateMessage
  myPlayerId: string
  /**
   * Start an offer: with this player (a tap on a name), for their shares of a chain (a tap on
   * a number in their row), or giving mine (a tap on a number in my row; no player yet).
   */
  onStart: (partnerId: string, chain?: ChainId, side?: 'give' | 'get') => void
}

/**
 * Where an offer starts (BL-021): who holds what, and every name and number is the button. "I
 * want Bob's 2 Sandpiper" is one tap on Bob's Sandpiper: the composer opens on Bob with one
 * Sandpiper asked for. One row per other player in seat order, mine last; one column per chain
 * anyone holds, in the ruleset's order; the majority holder's count filled with the chain
 * colour, the minority holder's outlined (the players table's marks).
 */
export function TradeStart({ gameState, myPlayerId, onStart }: TradeStartProps) {
  const rules = useRules()
  const order = gameState.turn_order?.length ? gameState.turn_order : Object.keys(gameState.players)
  const others = order.filter((id) => id !== myPlayerId && gameState.players[id])
  const rows = [...others, ...(gameState.players[myPlayerId] ? [myPlayerId] : [])]
  const chains = rules.rs.chains
    .map((c) => c.id)
    .filter((c) => rows.some((id) => (gameState.players[id].stocks[c] ?? 0) > 0))
  const names = shortNames(gameState.players)
  const share = rules.theme.share_noun_plural

  return (
    <section className={styles.start} aria-label="Start an offer" data-testid="trade-start">
      <header className={styles.header}>
        <h4 className={styles.title}>Start an offer</h4>
        <Hint id="trades">
          Tap a player, or the {share} you want. Offers are public: everyone sees them, and anyone
          can make a competing offer.
        </Hint>
      </header>
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          Who holds what: choose a player or their {share} to start an offer
        </caption>
        <colgroup>
          <col className={styles.nameCol} />
          {chains.map((c) => (
            <col key={c} />
          ))}
        </colgroup>
        {chains.length > 0 && (
          <thead>
            <tr>
              <th scope="col" className={styles.srOnly}>
                Player
              </th>
              {chains.map((c) => (
                <th key={c} scope="col" className={styles.chainHead}>
                  <ChainMarker chain={c} variant="icon" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((id) => {
            const p = gameState.players[id]
            const me = id === myPlayerId
            const head = names[id]?.head ?? p.name
            return (
              <tr key={id} className={me ? styles.me : undefined} data-testid={`trade-row-${id}`}>
                <th scope="row" className={styles.name}>
                  {me ? (
                    <span className={styles.mine}>You</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.nameButton}
                      onClick={() => onStart(id)}
                      aria-label={`Start an offer to ${p.name}`}
                      data-testid={`trade-start-${id}`}
                    >
                      <span className={styles.nameText} title={p.name}>
                        {head}
                      </span>
                      <SeatKindBadge
                        playerId={id}
                        kind={p.kind}
                        isBot={p.is_bot}
                        agentLabel={p.agent_label}
                        interactive={false}
                        testId={`trade-start-kind-${id}`}
                      />
                    </button>
                  )}
                </th>
                {chains.map((chain) => {
                  const n = p.stocks[chain] ?? 0
                  const holder = gameState.chain_holders?.[chain]?.holders.find(
                    (h) => h.player_id === id
                  )
                  const role = n > 0 ? (holder?.role ?? null) : null
                  return (
                    <td key={chain} className={styles.cell}>
                      {n > 0 ? (
                        <button
                          type="button"
                          className={styles.cellButton}
                          onClick={() => (me ? onStart('', chain, 'give') : onStart(id, chain))}
                          aria-label={
                            me
                              ? `Offer my ${rules.name(chain)} (I hold ${n})`
                              : `Ask ${p.name} for ${rules.name(chain)} (holds ${n})`
                          }
                          data-testid={`trade-start-${id}-${chain}`}
                        >
                          <span
                            className={`${styles.count} ${role ? styles[role] : ''}`}
                            style={role ? rules.style(chain) : undefined}
                          >
                            {role && holder?.tied && <span aria-hidden="true">=</span>}
                            {n}
                          </span>
                        </button>
                      ) : (
                        <span className={styles.nothing} aria-hidden="true">
                          ·
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
