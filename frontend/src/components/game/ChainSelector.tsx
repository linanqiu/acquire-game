import { useRef, useCallback } from 'react'
import { ChainMarker } from './ChainMarker'
import styles from './ChainSelector.module.css'
import type { ChainId } from '../../types/ruleset'
import { useRules } from '../../ruleset/useRules'
import { chainTestId, chainsByTier } from '../../lib/ruleset'

export interface ChainSelectorProps {
  availableChains: ChainId[]
  onSelect: (chain: ChainId) => void
  stockAvailability: Partial<Record<ChainId, number>>
  /** Label for chains that cannot be picked. Founding: "ACTIVE" (already on the board).
   *  Merger survivor choice: those chains are simply not part of the tie. */
  unavailableLabel?: string
  /**
   * Show only the chains that can be picked (BL-019: founding lists the chains not on the
   * board; the ones on the board are not a choice and are not repeated). Tiers left empty go.
   */
  onlyAvailable?: boolean
}

/** Every chain of the ruleset, grouped by tier (labels from the ruleset), the pickable ones enabled. */
export function ChainSelector({
  availableChains,
  onSelect,
  stockAvailability,
  unavailableLabel = 'ACTIVE',
  onlyAvailable = false,
}: ChainSelectorProps) {
  const rules = useRules()
  const tiers = chainsByTier(rules.rs)
  // Chains the server offers that the ruleset does not list still get a button.
  const listed = new Set(tiers.flatMap((t) => t.chains.map((c) => c.id)))
  const extra = availableChains.filter((c) => !listed.has(c))
  const groups: { key: string; label: string; chains: ChainId[] }[] = [
    ...tiers.map((t) => ({
      key: t.tier.id,
      label: t.tier.label,
      chains: t.chains
        .map((c) => c.id)
        .filter((c) => !onlyAvailable || availableChains.includes(c)),
    })),
    ...(extra.length ? [{ key: '__other', label: '', chains: extra }] : []),
  ].filter((g) => g.chains.length > 0)
  const allChains = groups.flatMap((g) => g.chains)
  const buttonRefs = useRef<Map<ChainId, HTMLButtonElement>>(new Map())

  const setButtonRef = useCallback((chain: ChainId, el: HTMLButtonElement | null) => {
    if (el) {
      buttonRefs.current.set(chain, el)
    } else {
      buttonRefs.current.delete(chain)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent, chain: ChainId) => {
    const currentIndex = allChains.indexOf(chain)

    // The next chain in `direction` that can be chosen (disabled buttons cannot take focus, so
    // stepping onto one would leave the keyboard user stuck), wrapping around.
    const nextChoosable = (direction: 1 | -1): number | null => {
      const n = allChains.length
      for (let step = 1; step <= n; step++) {
        const i = (currentIndex + direction * step + n * step) % n
        if (availableChains.includes(allChains[i])) return i
      }
      return null
    }

    let nextIndex: number | null = null

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = nextChoosable(1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = nextChoosable(-1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (availableChains.includes(chain)) {
        onSelect(chain)
      }
      return
    }

    if (nextIndex !== null) {
      const nextChain = allChains[nextIndex]
      const nextButton = buttonRefs.current.get(nextChain)
      nextButton?.focus()
    }
  }

  const sharesLeft = (n: number) => `${rules.shares(n)} left`

  return (
    <div
      className={`${styles.selector} ${onlyAvailable ? styles.compact : ''}`}
      data-testid="chain-selector"
      role="radiogroup"
    >
      {groups.map((tier) => (
        <div key={tier.key} className={styles.tier} data-testid={`chain-tier-${tier.key}`}>
          {tier.label && <div className={styles.tierLabel}>{tier.label}</div>}
          <div className={styles.chains}>
            {tier.chains.map((chain) => {
              const isAvailable = availableChains.includes(chain)
              const stockCount = stockAvailability[chain] ?? rules.rs.stocks_per_chain
              const name = rules.name(chain)

              return (
                <button
                  key={chain}
                  ref={(el) => setButtonRef(chain, el)}
                  className={`${styles.chainButton} ${isAvailable ? styles.available : styles.unavailable}`}
                  onClick={() => isAvailable && onSelect(chain)}
                  disabled={!isAvailable}
                  aria-label={`${name}${isAvailable ? `, ${sharesLeft(stockCount)}` : `, ${unavailableLabel === 'ACTIVE' ? 'already active' : unavailableLabel.toLowerCase()}`}`}
                  onKeyDown={(e) => handleKeyDown(e, chain)}
                  data-testid={`chain-button-${chainTestId(chain)}`}
                  role="radio"
                  aria-checked={false}
                >
                  <ChainMarker chain={chain} variant="compact" />
                  <span className={styles.stock}>
                    {isAvailable ? sharesLeft(stockCount) : unavailableLabel}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
