import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { SeatChip } from './SeatChip'
import { computeSeatStats, type Replay } from '../../lib/replay'
import { transcriptDownloadUrl } from '../../lib/transcripts'
import { formatCost, formatDateTime, formatMoney, formatTokens } from '../../lib/format'
import type { Transcript } from '../../types/transcripts'
import styles from './SummaryHeader.module.css'

const END_REASON: Record<string, string> = {
  declared: 'a player declared the game over',
  no_playable_tiles: 'no tile could be played any more',
  forced: 'ended by the server',
  abandoned: 'abandoned',
}

interface SummaryHeaderProps {
  transcript: Transcript
  replay: Replay
}

export function SummaryHeader({ transcript, replay }: SummaryHeaderProps) {
  const { header, footer, redacted } = transcript
  const derived = computeSeatStats(replay)
  const standing = new Map(footer?.standings.map((s) => [s.player_id, s]))
  const winnerIds = new Set(footer?.standings.filter((s) => s.rank === 1).map((s) => s.player_id))
  const live = !footer
  const seats = footer
    ? [...header.seats].sort(
        (a, b) => (standing.get(a.player_id)?.rank ?? 99) - (standing.get(b.player_id)?.rank ?? 99)
      )
    : header.seats

  return (
    <section className={styles.wrap} aria-label="Game summary" data-testid="summary-header">
      <div className={styles.top}>
        <div className={styles.titleBox}>
          <h1 className={styles.title}>
            GAME <code className={styles.id}>{header.game_id}</code>
          </h1>
          <div className={styles.badges}>
            {live ? (
              <Badge label={redacted ? 'IN PROGRESS' : 'UNFINISHED'} variant="safe" />
            ) : (
              <Badge
                label={footer.reason === 'abandoned' ? 'ABANDONED' : 'FINISHED'}
                variant={footer.reason === 'abandoned' ? 'warning' : 'default'}
              />
            )}
            {header.source === 'bench' && <Badge label="BENCH" variant="info" />}
            {header.room_code && <span className={styles.muted}>Room {header.room_code}</span>}
          </div>
        </div>
        <a
          className={styles.download}
          href={transcriptDownloadUrl(header.game_id)}
          download={`${header.game_id}.json`}
          data-testid="download-transcript"
        >
          Download transcript (JSON)
        </a>
      </div>

      <p className={styles.facts}>
        Started {formatDateTime(header.started_at)}
        {footer && <> · ended {formatDateTime(footer.ended_at)}</>}
        {footer && <> · {END_REASON[footer.reason] ?? footer.reason}</>}
        {header.seed !== null && <> · seed {header.seed}</>}
        {header.bench && (
          <>
            {' '}
            · series{' '}
            <Link to={`/bench/series/${encodeURIComponent(header.bench.series_id)}`}>
              {header.bench.series_id}
            </Link>{' '}
            ({header.bench.matchup}, rotation {header.bench.rotation})
          </>
        )}
      </p>

      {redacted && (
        <p className={styles.redacted} role="note" data-testid="redacted-banner">
          This game is still in progress, so only public information is shown. Prompts, the
          models&apos; private notes and reasons, and players&apos; hands unlock when the game ends.
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid="seat-summary">
          <thead>
            <tr>
              <th>{footer ? 'Rank' : 'Seat'}</th>
              <th>Player</th>
              {footer && <th className={styles.num}>Final</th>}
              <th className={styles.num}>Decisions</th>
              <th className={styles.num}>Retries</th>
              <th className={styles.num}>Fallbacks</th>
              <th className={styles.num}>Tokens in / out</th>
              <th className={styles.num}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((seat, i) => {
              const totals = footer?.totals?.[seat.player_id]
              const d = derived[seat.player_id]
              const decisions = totals?.decisions ?? d?.decisions ?? 0
              const retries = totals?.retries ?? d?.retries ?? 0
              const fallbacks = totals?.fallbacks ?? d?.fallbacks ?? 0
              const tin = totals?.input_tokens ?? d?.inputTokens ?? 0
              const tout = totals?.output_tokens ?? d?.outputTokens ?? 0
              const isAi = seat.kind === 'llm'
              const s = standing.get(seat.player_id)
              return (
                <tr key={seat.player_id} data-testid={`seat-row-${seat.player_id}`}>
                  <td className={styles.rank}>{footer ? (s?.rank ?? '—') : i + 1}</td>
                  <td>
                    <SeatChip seat={seat} winner={winnerIds.has(seat.player_id)} />
                  </td>
                  {footer && (
                    <td className={styles.num} data-testid={`score-${seat.player_id}`}>
                      {formatMoney(s?.score)}
                    </td>
                  )}
                  <td className={styles.num}>{decisions}</td>
                  <td className={styles.num}>{isAi ? retries : '—'}</td>
                  <td
                    className={`${styles.num} ${isAi && fallbacks > 0 ? styles.warn : ''}`}
                    data-testid={`fallbacks-${seat.player_id}`}
                  >
                    {isAi ? fallbacks : '—'}
                  </td>
                  <td className={styles.num}>
                    {isAi ? `${formatTokens(tin)} / ${formatTokens(tout)}` : '—'}
                  </td>
                  <td className={styles.num} data-testid={`cost-${seat.player_id}`}>
                    {isAi ? formatCost(totals?.cost_usd ?? null, 4) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
