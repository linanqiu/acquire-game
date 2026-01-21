import { useRef, useCallback } from 'react'
import { ChainMarker } from './ChainMarker'
import styles from './ChainSelector.module.css'
import type { ChainName } from '../../types/api'

const CHAIN_TIERS: { name: string; chains: ChainName[] }[] = [
  { name: 'BUDGET TIER', chains: ['Luxor', 'Tower'] },
  { name: 'STANDARD TIER', chains: ['American', 'Festival', 'Worldwide'] },
  { name: 'PREMIUM TIER', chains: ['Continental', 'Imperial'] },
]

const ALL_CHAINS = CHAIN_TIERS.flatMap((tier) => tier.chains)

export interface ChainSelectorProps {
  availableChains: ChainName[]
  selectedChain?: ChainName
  onSelect: (chain: ChainName) => void
  stockAvailability: Partial<Record<ChainName, number>>
}

export function ChainSelector({
  availableChains,
  selectedChain,
  onSelect,
  stockAvailability,
}: ChainSelectorProps) {
  const buttonRefs = useRef<Map<ChainName, HTMLButtonElement>>(new Map())

  const setButtonRef = useCallback((chain: ChainName, el: HTMLButtonElement | null) => {
    if (el) {
      buttonRefs.current.set(chain, el)
    } else {
      buttonRefs.current.delete(chain)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent, chain: ChainName) => {
    const currentIndex = ALL_CHAINS.indexOf(chain)

    let nextIndex: number | null = null

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % ALL_CHAINS.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + ALL_CHAINS.length) % ALL_CHAINS.length
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (availableChains.includes(chain)) {
        onSelect(chain)
      }
      return
    }

    if (nextIndex !== null) {
      const nextChain = ALL_CHAINS[nextIndex]
      const nextButton = buttonRefs.current.get(nextChain)
      nextButton?.focus()
    }
  }

  return (
    <div className={styles.selector} data-testid="chain-selector" role="radiogroup">
      {CHAIN_TIERS.map((tier) => (
        <div key={tier.name} className={styles.tier}>
          <div className={styles.tierLabel}>{tier.name}</div>
          <div className={styles.chains}>
            {tier.chains.map((chain) => {
              const isAvailable = availableChains.includes(chain)
              const isSelected = selectedChain === chain
              const stockCount = stockAvailability[chain] ?? 25

              return (
                <button
                  key={chain}
                  ref={(el) => setButtonRef(chain, el)}
                  className={`${styles.chainButton} ${isAvailable ? styles.available : styles.unavailable} ${isSelected ? styles.selected : ''}`}
                  onClick={() => isAvailable && onSelect(chain)}
                  disabled={!isAvailable}
                  aria-label={`${chain}${isAvailable ? `, ${stockCount} stock available` : ', already active'}`}
                  onKeyDown={(e) => handleKeyDown(e, chain)}
                  data-testid={`chain-button-${chain.toLowerCase()}`}
                  role="radio"
                  aria-checked={isSelected}
                >
                  <ChainMarker chain={chain} variant="compact" />
                  <span className={styles.stock}>
                    {isAvailable ? `${stockCount} stock avail` : 'ACTIVE'}
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
