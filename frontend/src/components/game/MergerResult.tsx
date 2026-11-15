import { ChainMarker } from './ChainMarker'
import { SeatKindBadge } from './SeatKindBadge'
import { chainTestId } from '../../lib/ruleset'
import { useRules } from '../../ruleset/useRules'
import type { GameStateMessage, MergerDefunctRecord, MergerRecord } from '../../types/api'
import styles from './MergerResult.module.css'

export interface MergerResultProps {
  merger: MergerRecord
  players: GameStateMessage['players']
  onDismiss: () => void
}

type Bonus = NonNullable<MergerDefunctRecord['bonuses']>[number]

function bonusLabel(b: Bonus, all: Bonus[]): string {
  if (b.majority > 0 && b.minority > 0) return '1st + 2nd (only holder)'
  if (b.majority > 0) return all.filter((o) => o.majority > 0).length > 1 ? '1st (tie)' : '1st'
  return all.filter((o) => o.minority > 0).length > 1 ? '2nd (tie)' : '2nd'
}

/**
 * What a merger did, from the server's merger record (amounts as the engine paid them): which
 * chain took over which, the sizes, who got the majority and minority bonus and how much, and
 * what every stockholder did with their shares as those decisions come in. Stays until closed.
 */
export function MergerResult({ merger, players, onDismiss }: MergerResultProps) {
  const rules = useRules()
  const { theme } = rules
  const nameOf = (id: string | null) => (id ? (players[id]?.name ?? '?') : '?')
  /** A stockholder's name with their seat badge (AI seats). */
  const who = (id: string) => {
    const p = players[id]
    return (
      <span className={styles.who}>
        {p?.name ?? '?'}
        {p && (
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

  return (
    <section
      className={styles.result}
      data-testid="merger-result"
      data-merger-seq={merger.seq}
      aria-label={`${theme.merger_noun} result`}
    >
      <header className={styles.header}>
        <h3 className={styles.title} data-testid="merger-result-title">
          {survivor} takes over {defunctNames}
        </h3>
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          data-testid="merger-result-dismiss"
          aria-label={`Close the ${theme.merger_noun} result`}
        >
          CLOSE ✕
        </button>
      </header>
      <p className={styles.summary} data-testid="merger-result-summary">
        {nameOf(merger.player_id)} placed {merger.tile ?? 'a tile'}.{' '}
        {merger.complete && merger.survivor_size !== null
          ? `${survivor} grows from ${before} to ${merger.survivor_size} tiles.`
          : `${theme.merger_noun[0].toUpperCase()}${theme.merger_noun.slice(1)} in progress.`}
      </p>

      {merger.defunct.map((d) => {
        const id = chainTestId(d.chain)
        const decided = new Set(d.dispositions.map((x) => x.player_id))
        return (
          <div key={d.chain} className={styles.defunct} data-testid={`merger-defunct-${id}`}>
            <div className={styles.defunctHead}>
              <ChainMarker chain={d.chain} variant="compact" />
              <span className={styles.muted}>
                {d.size} tiles at {rules.money(d.price)} per {theme.share_noun}
              </span>
            </div>
            {d.bonuses === null ? (
              <p className={styles.muted}>Bonuses are paid when its turn comes.</p>
            ) : d.bonuses.length === 0 ? (
              <p className={styles.muted}>Nobody held {theme.share_noun_plural}: no bonuses.</p>
            ) : (
              <table className={styles.table}>
                <caption className={styles.caption}>Bonuses paid</caption>
                <tbody>
                  {d.bonuses.map((b) => (
                    <tr key={b.player_id} data-testid={`merger-bonus-${id}-${b.player_id}`}>
                      <td className={styles.label}>{bonusLabel(b, d.bonuses!)}</td>
                      <td>{who(b.player_id)}</td>
                      <td className={styles.money}>+{rules.money(b.majority + b.minority)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(d.dispositions.length > 0 || d.waiting_on.length > 0) && (
              <table className={styles.table}>
                <caption className={styles.caption}>
                  {rules.name(d.chain)} {theme.share_noun_plural}
                </caption>
                <tbody>
                  {d.dispositions.map((x) => (
                    <tr key={x.player_id} data-testid={`merger-disposition-${id}-${x.player_id}`}>
                      <td>{who(x.player_id)}</td>
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
                        <td className={styles.muted}>{i === 0 ? 'deciding…' : 'to decide'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </section>
  )
}

export interface MergerLogProps {
  mergers: MergerRecord[]
  players: GameStateMessage['players']
  openSeq?: number | null
  onOpen: (seq: number) => void
}

/** Every merger of the game, newest first; each reopens its result card. */
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
