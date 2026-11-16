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
  /** Close button (a finished merger, or one reopened from the log). */
  onDismiss?: () => void
  dismissLabel?: string
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
 * Read-only for spectators and players who are not deciding.
 */
export function MergerResult({
  merger,
  players,
  gameState,
  myId,
  draft,
  onDismiss,
  dismissLabel = 'CLOSE ✕',
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

  const head = (
    <>
      <header className={styles.header}>
        <h3 className={styles.title} data-testid="merger-result-title">
          {survivor} takes over {defunctNames}
        </h3>
        {onDismiss && (
          <button
            type="button"
            className={styles.close}
            onClick={onDismiss}
            data-testid="merger-result-dismiss"
            aria-label={`Close the ${theme.merger_noun} result`}
          >
            {dismissLabel}
          </button>
        )}
      </header>
      <p className={styles.summary} data-testid="merger-result-summary">
        {nameOf(merger.player_id)} placed {merger.tile ?? 'a tile'}.{' '}
        {merger.complete && merger.survivor_size !== null
          ? `${survivor} grows from ${before} to ${merger.survivor_size} tiles.`
          : `${theme.merger_noun[0].toUpperCase()}${theme.merger_noun.slice(1)} in progress: ${survivor} grows from ${before} to ${afterSize ?? '?'} tiles.`}
      </p>
    </>
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
            {d.size} tiles, {rules.money(d.price)} a {theme.share_noun}
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
                    <td className={styles.muted}>
                      {i === 0
                        ? p === myId && draft
                          ? `deciding: sell ${draft.sell}, trade ${draft.trade}, keep ${
                              held(p) - draft.sell - draft.trade
                            }`
                          : 'deciding…'
                        : 'to decide'}
                    </td>
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
          <span>after the {theme.merger_noun}:</span>
          <span className={styles.fact} data-testid="survivor-after-size">
            {after.size} tiles
          </span>
          <span className={styles.fact} data-testid="survivor-after-price">
            {rules.money(after.price)}
          </span>
          <span className={styles.fact} data-testid="survivor-after-bank">
            bank {after.bank}
            {projecting ? ` → ${after.bank - myExtra}` : ''}
          </span>
        </div>
        <p className={styles.muted} data-testid="survivor-after-bonus">
          At that size 1st pays {rules.money(after.majority_bonus)}, 2nd{' '}
          {rules.money(after.minority_bonus)}.
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
            now {nowInfo.size} tiles, {rules.money(nowInfo.price)}, bank{' '}
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
  openSeq?: number | null
  onOpen: (seq: number) => void
}

/** Every merger of the game, newest first; each opens in the decision tab. */
export function MergerLog({ mergers, players, openSeq, onOpen }: MergerLogProps) {
  const rules = useRules()
  if (mergers.length === 0) return null
  return (
    <ul className={styles.log} data-testid="merger-log">
      {[...mergers].reverse().map((m) => (
        <li key={m.seq}>
          <button
            type="button"
            className={`${styles.logEntry} ${openSeq === m.seq ? styles.logOpen : ''}`}
            onClick={() => onOpen(m.seq)}
            data-testid={`merger-log-${m.seq}`}
          >
            {rules.name(m.survivor)} took over{' '}
            {m.defunct.map((d) => rules.name(d.chain)).join(', ')}
            <span className={styles.muted}>
              {' '}
              ({players[m.player_id ?? '']?.name ?? '?'}, {m.tile})
              {m.complete ? '' : ' · in progress'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
