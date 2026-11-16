import { useState, type ReactNode } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { Hint } from '../../components/ui/Hint'
import { ChainMarker } from '../../components/game/ChainMarker'
import { ChainSelector } from '../../components/game/ChainSelector'
import { HolderChips } from '../../components/game/HolderChips'
import { MergerLog, MergerResult } from '../../components/game/MergerResult'
import { MergerDisposition, type DispositionDraft } from '../../components/game/MergerDisposition'
import { chainTestId, withArticle } from '../../lib/ruleset'
import type { DecisionView } from '../../lib/decision'
import { useRules } from '../../ruleset/useRules'
import type { useMergerResult } from '../../hooks/useMergerResult'
import type { ChainId, GameStateMessage, MergerRecord } from '../../types/api'
import { BuyPanel, type Purchases } from './BuyPanel'
import styles from './DecisionTab.module.css'

type HotelChain = GameStateMessage['hotel']['chains'][number]

export interface DecisionTabProps {
  view: DecisionView
  gameState: GameStateMessage
  myId?: string
  isMyTurn: boolean
  /** "Waiting for Bob to buy shares..." */
  waiting: string
  /** Incoming trade offers (they are decisions too): shown first in every view. */
  incoming?: ReactNode
  /** Why rack tiles cannot be played (place-tile view). */
  rackNotes?: ReactNode
  /** The players matrix: always in the panel, under whatever needs me. */
  standings?: ReactNode
  pendingChainChoice: ChainId[] | null
  pendingMergerChoice: ChainId[] | null
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
  // My sell / trade choice being prepared, for the disposition it belongs to.
  const [drafted, setDrafted] = useState<{ key: string; draft: DispositionDraft } | null>(null)
  const mergers = gameState.mergers ?? []
  const last = mergers[mergers.length - 1] as MergerRecord | undefined
  const live = last && !last.complete ? last : undefined
  const me = myId ? players[myId] : undefined

  // The merger shown in full by the view itself (not repeated in the log line under it).
  let shownSeq: number | null = null
  // A decision with a pinned footer fills the panel; the matrix is under it, one scroll away.
  let fill = false
  let body: ReactNode
  switch (p.view) {
    case 'survivor':
      body = (
        <section className={styles.section} aria-label="Choose the survivor">
          <div className={styles.titleRow}>
            <h3 className={styles.title}>Choose the surviving {theme.chain_noun}</h3>
            <Hint id="survivor">
              The tied {theme.chain_noun_plural} are the same size; the one you pick takes over the
              other{p.pendingMergerChoice && p.pendingMergerChoice.length > 2 ? 's' : ''}.
            </Hint>
          </div>
          <ChainSelector
            availableChains={p.pendingMergerChoice ?? []}
            onSelect={p.onSurvivor}
            stockAvailability={gameState.hotel.available_stocks}
            unavailableLabel="NOT TIED"
          />
          <ChainFacts chains={p.pendingMergerChoice ?? []} gameState={gameState} myId={myId} />
        </section>
      )
      break
    case 'found':
      body = (
        <section className={styles.section} aria-label="Found a chain">
          <div className={styles.titleRow}>
            <h3 className={styles.title}>Found {withArticle(theme.chain_noun)}</h3>
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
      const draft = drafted?.key === key ? drafted.draft : undefined
      const defunctPrice =
        record?.defunct.find((x) => x.chain === d.defunctChain)?.price ??
        gameState.hotel.chains.find((c) => c.name === d.defunctChain)?.price ??
        0
      shownSeq = record?.seq ?? null
      fill = true
      body = (
        <MergerDisposition
          key={key}
          defunctChain={d.defunctChain}
          survivorChain={d.survivingChain}
          sharesOwned={d.stockCount}
          defunctPrice={defunctPrice}
          survivorStockAvailable={d.availableToTrade}
          cash={me?.money}
          survivorShares={me?.stocks[d.survivingChain] ?? 0}
          onDraftChange={(next) => setDrafted({ key, draft: next })}
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
              draft={draft}
              part="body"
            />
          )}
        </MergerDisposition>
      )
      break
    }
    case 'merger':
      shownSeq = live?.seq ?? null
      body = (
        <>
          <div className={styles.waiting}>
            <Spinner size="sm" />
            <p data-testid="waiting-message">{p.waiting}</p>
          </div>
          {live && (
            <MergerResult merger={live} players={players} gameState={gameState} myId={myId} />
          )}
        </>
      )
      break
    case 'buy':
      fill = true
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
      body = (
        <>
          <p className={styles.waiting} data-testid="waiting-message">
            {p.waiting}
          </p>
          {result && (
            <MergerResult merger={result} players={players} gameState={gameState} myId={myId} />
          )}
        </>
      )
    }
  }

  return (
    <div className={styles.decision} data-testid="decision-view" data-view={p.view}>
      {p.incoming}
      {fill ? <div className={styles.fill}>{body}</div> : body}
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

/** Each option of a choice: size, price, bank stock and who holds it (survivor choice). */
function ChainFacts({
  chains,
  gameState,
  myId,
}: {
  chains: ChainId[]
  gameState: GameStateMessage
  myId?: string
}) {
  const rules = useRules()
  return (
    <div className={styles.facts}>
      {chains.map((chain) => {
        const info = gameState.chain_holders?.[chain]
        const id = chainTestId(chain)
        return (
          <div key={chain} className={styles.fact} data-testid={`choice-facts-${id}`}>
            <span className={styles.factHead}>
              <ChainMarker chain={chain} variant="compact" />
              <span className={styles.mono}>
                {info?.size ?? '?'} tiles · {rules.money(info?.price)} ·{' '}
                {gameState.hotel.available_stocks[chain] ?? 0} left
              </span>
            </span>
            <HolderChips
              holders={info?.holders ?? []}
              players={gameState.players}
              me={myId}
              testId={`choice-holders-${id}`}
            />
          </div>
        )
      })}
    </div>
  )
}
