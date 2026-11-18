import { useState } from 'react'
import { ChainMarker } from './ChainMarker'
import { HolderChips } from './HolderChips'
import { SeatKindBadge } from './SeatKindBadge'
import { chainTestId } from '../../lib/ruleset'
import { changeText, placeOf, placeText } from '../../lib/standing'
import { useRules } from '../../ruleset/useRules'
import type {
  GameStateMessage,
  MergerDefunctRecord,
  MergerRecord,
  SurvivorAfterHolder,
} from '../../types/api'
import type { DispositionDraft } from './MergerDisposition'
import styles from './MergerResult.module.css'

export interface MergerResultProps {
  merger: MergerRecord
  players: GameStateMessage['players']
  /** The whole game state: the survivor's holders once the merger is over. */
  gameState?: GameStateMessage
  /** The viewer (player page): "you", and the live projection of my choice. */
  myId?: string
  /** My sell / trade choice being prepared (while I decide). */
  draft?: DispositionDraft
  /** `head`: title and summary; `body`: stockholders and the survivor after; `all`: both. */
  part?: 'all' | 'head' | 'body'
}

type Bonus = NonNullable<MergerDefunctRecord['bonuses']>[number]

function bonusLabel(b: Bonus, all: Bonus[]): string {
  if (b.majority > 0 && b.minority > 0) return '1st + 2nd (only holder)'
  if (b.majority > 0) return all.filter((o) => o.majority > 0).length > 1 ? '1st (tie)' : '1st'
  return all.filter((o) => o.minority > 0).length > 1 ? '2nd (tie)' : '2nd'
}

/**
 * A merger in one view (BL-007, BL-011), from the server's merger record (amounts as the engine
 * paid them): which chain takes over which, sizes and prices, the bonuses paid, every
 * stockholder of each defunct chain with what they did or still have to decide, and the
 * survivor as it will be after the merger (engine size, price, bonuses; everyone's shares with
 * the trades made so far, who is still undecided, and my position as I move the trade slider).
 * Read-only for spectators and players who are not deciding. There is nothing to close: the
 * page shows it while it matters (`useMergerResult`) and the log keeps it afterwards.
 */
export function MergerResult({
  merger,
  players,
  gameState,
  myId,
  draft,
  part = 'all',
}: MergerResultProps) {
  const rules = useRules()
  const { theme } = rules
  const ratio = Math.max(1, rules.rs.merger_trade_ratio)
  const nameOf = (id: string | null) => (id ? (players[id]?.name ?? '?') : '?')
  /** A stockholder's name with their seat badge (AI seats). */
  const who = (id: string) => {
    const p = players[id]
    return (
      <span className={styles.who}>
        {id === myId ? <strong>You</strong> : (p?.name ?? '?')}
        {p && id !== myId && (
          <SeatKindBadge
            playerId={id}
            kind={p.kind}
            isBot={p.is_bot}
            agentLabel={p.agent_label}
            playerName={p.name}
          />
        )}
      </span>
    )
  }
  const survivor = rules.name(merger.survivor)
  const defunctNames = merger.defunct.map((d) => rules.name(d.chain)).join(' and ')
  const before = merger.sizes[merger.survivor]
  const after = merger.survivor_after ?? null
  const afterSize = merger.survivor_size ?? after?.size ?? null
  const sid = chainTestId(merger.survivor)
  // Around my own sell / trade / keep controls, which already give the defunct price.
  const deciding = part === 'body'

  // One line: what happened, then who placed which tile and the survivor's size (its name is
  // in the title already).
  const head = (
    <header className={styles.header}>
      <h3 className={styles.title} data-testid="merger-result-title">
        {survivor} takes over {defunctNames}
      </h3>
      <p className={styles.summary} data-testid="merger-result-summary">
        {nameOf(merger.player_id)}, {merger.tile ?? 'a tile'} · {before} →{' '}
        {(merger.complete ? merger.survivor_size : afterSize) ?? '?'} tiles
      </p>
    </header>
  )

  const defunctSections = merger.defunct.map((d) => {
    const id = chainTestId(d.chain)
    const decided = new Set(d.dispositions.map((x) => x.player_id))
    // A defunct chain waiting its turn (multi-chain merger): its holders decide later.
    const queued = d.bonuses === null && d.dispositions.length === 0 && d.waiting_on.length === 0
    const later = queued
      ? Object.entries(players)
          .filter(([, p]) => (p.stocks[d.chain] ?? 0) > 0)
          .map(([pid]) => pid)
      : []
    const held = (pid: string) => players[pid]?.stocks[d.chain] ?? 0
    // The bonus the engine paid this holder, in their row.
    const bonus = (pid: string) => {
      const b = d.bonuses?.find((x) => x.player_id === pid)
      return (
        <td className={styles.money}>
          {b && (
            <span data-testid={`merger-bonus-${id}-${pid}`}>
              <span className={styles.label}>{bonusLabel(b, d.bonuses!)}</span> +
              {rules.money(b.majority + b.minority)}
            </span>
          )}
        </td>
      )
    }
    return (
      <div key={d.chain} className={styles.defunct} data-testid={`merger-defunct-${id}`}>
        <div className={styles.defunctHead}>
          <ChainMarker chain={d.chain} variant="compact" />
          <span className={styles.muted}>
            {d.size} tiles{deciding ? '' : ` · ${rules.money(d.price)}`}
          </span>
        </div>
        {d.bonuses === null ? (
          <p className={styles.muted}>Bonuses are paid when its turn comes.</p>
        ) : d.bonuses.length === 0 ? (
          <p className={styles.muted}>Nobody held {theme.share_noun_plural}: no bonuses.</p>
        ) : null}
        {(d.dispositions.length > 0 || d.waiting_on.length > 0 || later.length > 0) && (
          <table className={styles.table}>
            <caption className={styles.caption}>
              {rules.name(d.chain)} {theme.share_noun_plural}: holders, bonuses paid, decisions
            </caption>
            <tbody>
              {d.dispositions.map((x) => (
                <tr key={x.player_id} data-testid={`merger-disposition-${id}-${x.player_id}`}>
                  <td>{who(x.player_id)}</td>
                  <td className={styles.num}>{x.sell + x.trade + x.hold}</td>
                  {bonus(x.player_id)}
                  <td>
                    {[
                      x.sell > 0 && `sold ${x.sell} (+${rules.money(x.sale_proceeds)})`,
                      x.trade > 0 &&
                        `traded ${x.trade} for ${x.survivor_shares_received} ${survivor}`,
                      x.hold > 0 && `kept ${x.hold}`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                </tr>
              ))}
              {d.waiting_on
                .filter((p) => !decided.has(p))
                .map((p, i) => (
                  <tr key={p} data-testid={`merger-waiting-${id}-${p}`}>
                    <td>{who(p)}</td>
                    <td className={styles.num}>{held(p)}</td>
                    {bonus(p)}
                    <td className={styles.muted}>{i === 0 ? 'deciding…' : 'to decide'}</td>
                  </tr>
                ))}
              {later.map((p) => (
                <tr key={p} data-testid={`merger-waiting-${id}-${p}`}>
                  <td>{who(p)}</td>
                  <td className={styles.num}>{held(p)}</td>
                  <td />
                  <td className={styles.muted}>to decide later</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    )
  })

  // The survivor after the merger (in progress), or its holders now (finished).
  const nowInfo = merger.complete ? gameState?.chain_holders?.[merger.survivor] : undefined
  const myExtra = draft ? Math.floor(draft.trade / ratio) : 0
  let survivorSection = null
  if (after) {
    const rows: SurvivorAfterHolder[] = after.holders
    const counts = rows.map((h) => ({ player_id: h.player_id, shares: h.shares }))
    const mine = rows.find((h) => h.player_id === myId)
    const projecting = myExtra > 0
    // Everyone's count with my trade in it: the others' places as they would be.
    const projected = counts.map((c) =>
      c.player_id === myId ? { ...c, shares: c.shares + myExtra } : c
    )
    if (myId && !mine && projecting) projected.push({ player_id: myId, shares: myExtra })
    survivorSection = (
      <div className={styles.survivor} data-testid="merger-survivor-after">
        <div className={styles.defunctHead}>
          <ChainMarker chain={merger.survivor} variant="compact" />
          <span className={styles.muted}>after</span>
          <span className={styles.fact} data-testid="survivor-after-price">
            {rules.money(after.price)}
          </span>
          <span className={styles.fact} data-testid="survivor-after-bank">
            bank {after.bank}
            {projecting ? ` → ${after.bank - myExtra}` : ''}
          </span>
        </div>
        <p className={styles.bonusLine} data-testid="survivor-after-bonus">
          1st {rules.money(after.majority_bonus)} · 2nd {rules.money(after.minority_bonus)}
        </p>
        <table className={styles.table}>
          <caption className={styles.caption}>
            {survivor} {theme.share_noun_plural} after the {theme.merger_noun}
          </caption>
          <tbody>
            {rows.map((h) => {
              const isMe = h.player_id === myId
              const shares = isMe ? h.shares + myExtra : h.shares
              const place = placeOf(projected, h.player_id, shares)
              return (
                <tr
                  key={h.player_id}
                  className={isMe ? styles.meRow : undefined}
                  data-testid={`survivor-row-${h.player_id}`}
                  data-shares={shares}
                >
                  <td>{who(h.player_id)}</td>
                  <td className={styles.num}>
                    {isMe && projecting ? `${h.shares}→${shares}` : shares}
                    {h.received > 0 && (
                      <span className={styles.muted}> (+{h.received} traded)</span>
                    )}
                  </td>
                  <td className={styles.status}>
                    {isMe && projecting ? (
                      <span data-testid="survivor-my-place">
                        {changeText(counts, h.player_id, h.shares, myExtra) || placeText(place)}
                      </span>
                    ) : (
                      <>
                        {shares > 0 && placeText(place)}
                        {h.undecided && (
                          <span className={styles.undecided}>
                            {shares > 0 ? ' · ' : ''}undecided
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={styles.money}>
                    {!projecting && h.bonus > 0 ? rules.money(h.bonus) : ''}
                  </td>
                </tr>
              )
            })}
            {myId && !mine && myExtra > 0 && (
              <tr
                className={styles.meRow}
                data-testid={`survivor-row-${myId}`}
                data-shares={myExtra}
              >
                <td>{who(myId)}</td>
                <td className={styles.num}>0→{myExtra}</td>
                <td className={styles.status} data-testid="survivor-my-place">
                  {changeText(counts, myId, 0, myExtra)}
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )
  } else if (nowInfo) {
    survivorSection = (
      <div className={styles.survivor} data-testid="merger-survivor-now">
        <div className={styles.defunctHead}>
          <ChainMarker chain={merger.survivor} variant="compact" />
          <span className={styles.muted}>
            now {nowInfo.size} tiles · {rules.money(nowInfo.price)} · bank{' '}
            {gameState?.hotel.available_stocks[merger.survivor] ?? '?'}
          </span>
        </div>
        <HolderChips
          holders={nowInfo.holders}
          players={players}
          me={myId}
          testId={`merger-survivor-holders-${sid}`}
        />
      </div>
    )
  }

  return (
    <section
      className={styles.result}
      data-testid={part === 'body' ? 'merger-result-body' : 'merger-result'}
      data-merger-seq={merger.seq}
      aria-label={`${theme.merger_noun} result`}
    >
      {part !== 'body' && head}
      {part !== 'head' && (
        <>
          {defunctSections}
          {survivorSection}
        </>
      )}
    </section>
  )
}

export interface MergerLogProps {
  mergers: MergerRecord[]
  players: GameStateMessage['players']
  /** For the survivor's holders in an opened entry. */
  gameState?: GameStateMessage
  myId?: string
  /** Mergers shown elsewhere on the page right now are left out. */
  hideSeq?: number | null
  /** At most this many, newest first (the table panel shows one). */
  limit?: number
  /** Said before each line, e.g. "Last merger". */
  prefix?: string
  testId?: string
}

/**
 * The mergers of the game, newest first, one quiet line each ("Marlowe ← Halcyon"). A line
 * opens in place to the full result and closes again when tapped: the outcome stays findable
 * without a view that has to be dismissed.
 */
export function MergerLog({
  mergers,
  players,
  gameState,
  myId,
  hideSeq,
  limit,
  prefix,
  testId = 'merger-log',
}: MergerLogProps) {
  const rules = useRules()
  const [open, setOpen] = useState<number | null>(null)
  const list = [...mergers].reverse().filter((m) => m.seq !== hideSeq)
  const shown = limit ? list.slice(0, limit) : list
  if (shown.length === 0) return null
  return (
    <ul className={styles.log} data-testid={testId}>
      {shown.map((m) => {
        const isOpen = open === m.seq
        return (
          <li key={m.seq}>
            <button
              type="button"
              className={`${styles.logEntry} ${isOpen ? styles.logOpen : ''}`}
              onClick={() => setOpen(isOpen ? null : m.seq)}
              aria-expanded={isOpen}
              data-testid={`merger-log-${m.seq}`}
            >
              <span className={styles.logText}>
                {prefix && <span className={styles.muted}>{prefix}: </span>}
                {rules.name(m.survivor)} ← {m.defunct.map((d) => rules.name(d.chain)).join(', ')}
                <span className={styles.muted}>
                  {' '}
                  ({players[m.player_id ?? '']?.name ?? '?'}, {m.tile})
                  {m.complete ? '' : ' · in progress'}
                </span>
              </span>
              <span className={styles.chevron} aria-hidden="true">
                {isOpen ? '▾' : '▸'}
              </span>
            </button>
            {isOpen && (
              <div className={styles.logBody}>
                <MergerResult merger={m} players={players} gameState={gameState} myId={myId} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
