import { ChainMarker } from '../../components/game/ChainMarker'
import { HolderChips } from '../../components/game/HolderChips'
import { Hint } from '../../components/ui/Hint'
import { chainTestId } from '../../lib/ruleset'
import { markHintSeen } from '../../lib/hints'
import { useRules } from '../../ruleset/useRules'
import type { ChainId, GameStateMessage } from '../../types/api'
import styles from './MergerOrderChoice.module.css'

export interface SurvivorChoiceProps {
  /** The same-size chains the server offers. */
  tiedChains: ChainId[]
  gameState: GameStateMessage
  myId?: string
  disabled?: boolean
  onChoose: (chain: ChainId) => void
}

/**
 * My choice of the surviving chain when the merging chains are the same size (BL-019): one
 * tappable row per tied chain (the others are not offered, so they are not shown), each with
 * its size, price and bank stock, the bonuses it would pay if it were absorbed, and who holds
 * it. The phase bar is the question; the rows are the answers. The same rows as the merger
 * order choice.
 */
export function SurvivorChoice({
  tiedChains,
  gameState,
  myId,
  disabled = false,
  onChoose,
}: SurvivorChoiceProps) {
  const rules = useRules()
  const { theme } = rules
  return (
    <section
      className={styles.section}
      aria-label={`Choose the surviving ${theme.chain_noun}`}
      data-testid="survivor-choice"
    >
      <div className={styles.titleRow}>
        <Hint id="survivor">
          Same size, so you pick: the one you pick takes over the other
          {tiedChains.length > 2 ? 's' : ''}, whose holders are paid their bonuses.
        </Hint>
      </div>
      <div className={styles.options} role="group" data-testid="chain-selector">
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
                markHintSeen('survivor')
                onChoose(chain)
              }}
              data-testid={`chain-button-${id}`}
            >
              <span className={styles.contents} data-testid={`choice-facts-${id}`}>
                <span className={styles.head}>
                  <ChainMarker chain={chain} variant="compact" />
                  <span className={styles.num}>
                    {info?.size ?? '?'} tiles · {rules.money(info?.price)} ·{' '}
                    {gameState.hotel.available_stocks[chain] ?? 0} left
                  </span>
                </span>
                <span className={styles.detail}>
                  <span className={styles.num}>
                    1st {rules.money(info?.majority_bonus)} · 2nd{' '}
                    {rules.money(info?.minority_bonus)}
                  </span>
                  <HolderChips
                    holders={info?.holders ?? []}
                    players={gameState.players}
                    me={myId}
                    testId={`choice-holders-${id}`}
                  />
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
