import { ChainMarker } from '../../components/game/ChainMarker'
import { HolderChips } from '../../components/game/HolderChips'
import { Hint } from '../../components/ui/Hint'
import { chainTestId } from '../../lib/ruleset'
import { markHintSeen } from '../../lib/hints'
import { useRules } from '../../ruleset/useRules'
import type { ChainId, GameStateMessage, MergerRecord } from '../../types/api'
import styles from './MergerOrderChoice.module.css'

export interface MergerOrderChoiceProps {
  /** The same-size defunct chains the server offers. */
  tiedChains: ChainId[]
  survivingChain: ChainId
  /** The merger in progress (says whether a chain was absorbed already). */
  merger?: MergerRecord
  gameState: GameStateMessage
  myId?: string
  disabled?: boolean
  onChoose: (chain: ChainId) => void
}

/**
 * My choice as the player who placed the merging tile: which of the same-size defunct chains
 * is absorbed first. One tappable row per chain with what the order changes: its size and
 * price, the bonuses it pays and who holds it (they trade for survivor shares first).
 */
export function MergerOrderChoice({
  tiedChains,
  survivingChain,
  merger,
  gameState,
  myId,
  disabled = false,
  onChoose,
}: MergerOrderChoiceProps) {
  const rules = useRules()
  const { theme } = rules
  const started = merger?.defunct.some((d) => d.bonuses !== null) ?? false
  const bank = gameState.hotel.available_stocks[survivingChain] ?? 0
  return (
    <section
      className={styles.section}
      aria-label="Choose the merger order"
      data-testid="merger-order"
    >
      <div className={styles.titleRow}>
        <h3 className={styles.title} data-testid="merger-order-title">
          Which {theme.chain_noun} is absorbed {started ? 'next' : 'first'}?
        </h3>
        <Hint id="merger-order">
          Same size, so you pick. Holders of the first are paid and trade first: {bank}{' '}
          {rules.name(survivingChain)} left in the bank.
        </Hint>
      </div>
      <div className={styles.options} role="group">
        {tiedChains.map((chain) => {
          const info = gameState.chain_holders?.[chain]
          const id = chainTestId(chain)
          return (
            <button
              key={chain}
              type="button"
              className={styles.option}
              disabled={disabled}
              onClick={() => {
                markHintSeen('merger-order')
                onChoose(chain)
              }}
              data-testid={`merger-order-${id}`}
            >
              <span className={styles.head}>
                <ChainMarker chain={chain} variant="compact" />
                <span className={styles.num} data-testid={`merger-order-facts-${id}`}>
                  {info?.size ?? '?'} tiles · {rules.money(info?.price)}
                </span>
              </span>
              <span className={styles.detail}>
                <span className={styles.num} data-testid={`merger-order-bonus-${id}`}>
                  1st {rules.money(info?.majority_bonus)} · 2nd {rules.money(info?.minority_bonus)}
                </span>
                <HolderChips
                  holders={info?.holders ?? []}
                  players={gameState.players}
                  me={myId}
                  testId={`merger-order-holders-${id}`}
                />
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
