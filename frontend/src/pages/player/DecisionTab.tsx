import type { ReactNode } from 'react'
import { Hint } from '../../components/ui/Hint'
import { ChainSelector } from '../../components/game/ChainSelector'
import { MergerLog, MergerResult } from '../../components/game/MergerResult'
import { MergerDisposition } from '../../components/game/MergerDisposition'
import { withArticle } from '../../lib/ruleset'
import type { DecisionView } from '../../lib/decision'
import { useRules } from '../../ruleset/useRules'
import type { useMergerResult } from '../../hooks/useMergerResult'
import type { ChainId, GameStateMessage, MergerRecord } from '../../types/api'
import { BuyPanel, type Purchases } from './BuyPanel'
import { MergerOrderChoice } from './MergerOrderChoice'
import { SurvivorChoice } from './SurvivorChoice'
import styles from './DecisionTab.module.css'

type HotelChain = GameStateMessage['hotel']['chains'][number]

export interface DecisionTabProps {
  view: DecisionView
  gameState: GameStateMessage
  myId?: string
  isMyTurn: boolean
  /** Incoming trade offers (they are decisions too): shown first in every view. */
  incoming?: ReactNode
  /** Why rack tiles cannot be played (place-tile view). */
  rackNotes?: ReactNode
  /** The players matrix: always in the panel, under whatever needs me. */
  standings?: ReactNode
  pendingChainChoice: ChainId[] | null
  pendingMergerChoice: ChainId[] | null
  pendingMergerOrder?: { tiedChains: ChainId[]; survivingChain: ChainId } | null
  pendingStockDisposition: {
    defunctChain: ChainId
    survivingChain: ChainId
    stockCount: number
    availableToTrade: number
  } | null
  activeChains: HotelChain[]
  merger: ReturnType<typeof useMergerResult>
  loading: boolean
  onFound: (chain: ChainId) => void
  onSurvivor: (chain: ChainId) => void
  onMergerOrder?: (chain: ChainId) => void
  onDispose: (defunct: ChainId, sell: number, trade: number, hold: number) => void
  onBuy: (purchases: Purchases) => void
  onDeclareEndGame: () => void
}

/**
 * The table panel of the player page (BL-011, BL-013): under the board on a phone, the first
 * sidebar tab on a wide screen. From the top: a trade offer for me; my decision with what is
 * needed to make it (or the merger in progress, or who the table waits for); the players
 * matrix; the last merger as one quiet line that opens in place. A decision appears here by
 * itself and goes when it is made; nothing here has to be closed.
 */
export function DecisionTab(p: DecisionTabProps) {
  const rules = useRules()
  const { theme } = rules
  const { gameState, myId } = p
  const players = gameState.players
  const mergers = gameState.mergers ?? []
  const last = mergers[mergers.length - 1] as MergerRecord | undefined
  const live = last && !last.complete ? last : undefined
  const me = myId ? players[myId] : undefined

  // The merger shown in full by the view itself (not repeated in the log line under it).
  let shownSeq: number | null = null
  let body: ReactNode
  switch (p.view) {
    case 'survivor':
      body = (
        <SurvivorChoice
          tiedChains={p.pendingMergerChoice ?? []}
          gameState={gameState}
          myId={myId}
          disabled={p.loading}
          onChoose={p.onSurvivor}
        />
      )
      break
    case 'order':
      body = p.pendingMergerOrder && (
        <MergerOrderChoice
          tiedChains={p.pendingMergerOrder.tiedChains}
          survivingChain={p.pendingMergerOrder.survivingChain}
          merger={live}
          gameState={gameState}
          myId={myId}
          disabled={p.loading}
          onChoose={(chain) => p.onMergerOrder?.(chain)}
        />
      )
      break
    case 'found':
      body = (
        <section className={styles.section} aria-label={`Found ${withArticle(theme.chain_noun)}`}>
          <div className={styles.titleRow}>
            <Hint id="found">
              You get {rules.rs.founder_bonus_shares} free {theme.share_noun}. Prices by tier:{' '}
              {rules.rs.tiers
                .map((t) => `${t.label} from ${rules.money(t.prices[0]?.price ?? 0)}`)
                .join(' · ')}
              .
            </Hint>
          </div>
          <ChainSelector
            availableChains={p.pendingChainChoice ?? []}
            onSelect={p.onFound}
            stockAvailability={gameState.hotel.available_stocks}
          />
        </section>
      )
      break
    case 'disposition': {
      const d = p.pendingStockDisposition!
      const record = live ?? last
      const key = `${record?.seq}:${d.defunctChain}`
      const defunctPrice =
        record?.defunct.find((x) => x.chain === d.defunctChain)?.price ??
        gameState.hotel.chains.find((c) => c.name === d.defunctChain)?.price ??
        0
      shownSeq = record?.seq ?? null
      body = (
        <MergerDisposition
          key={key}
          defunctChain={d.defunctChain}
          survivorChain={d.survivingChain}
          sharesOwned={d.stockCount}
          defunctPrice={defunctPrice}
          survivorStockAvailable={d.availableToTrade}
          cash={me?.money}
          survivorHolders={record?.survivor_after?.holders}
          myId={myId}
          onConfirm={(sell, trade, hold) => p.onDispose(d.defunctChain, sell, trade, hold)}
          header={
            record && (
              <MergerResult merger={record} players={players} gameState={gameState} part="head" />
            )
          }
        >
          {record && (
            <MergerResult
              merger={record}
              players={players}
              gameState={gameState}
              myId={myId}
              part="body"
            />
          )}
        </MergerDisposition>
      )
      break
    }
    case 'merger':
      shownSeq = live?.seq ?? null
      // Who the table waits for is in the phase bar and in that stockholder's row.
      body = live && (
        <MergerResult merger={live} players={players} gameState={gameState} myId={myId} />
      )
      break
    case 'buy':
      body = (
        <BuyPanel
          chains={p.activeChains}
          bank={gameState.hotel.available_stocks}
          cash={me?.money ?? 0}
          gameState={gameState}
          myId={myId}
          isMyTurn={p.isMyTurn}
          endGameAvailable={!!gameState.end_game_available}
          loading={p.loading}
          onSubmit={p.onBuy}
          onDeclareEndGame={p.onDeclareEndGame}
        />
      )
      break
    case 'place':
      // How to place is behind the "?" of the phase bar (BL-014): no line of the panel for it.
      body = p.rackNotes
      break
    default: {
      // Someone else's move. A merger that just ended stays until the next tile is placed.
      const result = p.merger.auto
      shownSeq = result?.seq ?? null
      // Whose move it is: the phase bar and the marker on their row say it.
      body = result && (
        <MergerResult merger={result} players={players} gameState={gameState} myId={myId} />
      )
    }
  }

  return (
    <div className={styles.decision} data-testid="decision-view" data-view={p.view}>
      {p.incoming}
      {body}
      {p.standings}
      <MergerLog
        mergers={mergers}
        players={players}
        gameState={gameState}
        myId={myId}
        hideSeq={shownSeq}
        limit={1}
        prefix={`Last ${theme.merger_noun}`}
        testId="decision-last-merger"
      />
    </div>
  )
}
