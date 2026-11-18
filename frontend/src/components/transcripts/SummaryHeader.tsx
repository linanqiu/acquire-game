import { memo } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { SeatChip } from './SeatChip'
import { computeSeatStats, type Replay } from '../../lib/replay'
import { transcriptDownloadUrl } from '../../lib/transcripts'
import { formatCost, formatDateTime, formatTokens } from '../../lib/format'
import { useRules } from '../../ruleset/useRules'
import type { Transcript } from '../../types/transcripts'
import styles from './SummaryHeader.module.css'

const END_REASON: Record<string, string> = {
  declared: 'ended by declaration',
  no_playable_tiles: 'no playable tiles left',
  forced: 'ended by the server',
  abandoned: 'abandoned',
}

/** "Nov 18" (UTC, as the full times in the details are). */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "6 min", "1 h 12 min", "under a minute". */
function duration(from: string | null | undefined, to: string | null | undefined): string {
  const a = Date.parse(from ?? '')
  const b = Date.parse(to ?? '')
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return ''
  const min = Math.round((b - a) / 60000)
  if (min < 1) return 'under a minute'
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

interface SummaryHeaderProps {
  transcript: Transcript
  replay: Replay
}

/**
 * The transcript's title (BL-019): who won (or that the game is still on), one short line of
 * facts (date, length, how it ended, players), the record's details (ids, times, seed, prompt,
 * series, download) behind "Details", and the seats as one table that fits a phone: rank,
 * player on one line, final money, decisions; an AI seat's retries, fallbacks, tokens and cost
 * on a quiet line under its name. Nothing scrolls sideways.
 */
export const SummaryHeader = memo(function SummaryHeader({
  transcript,
  replay,
}: SummaryHeaderProps) {
  const rules = useRules()
  const { header, footer, redacted } = transcript
  const derived = computeSeatStats(replay)
  // Totals: the footer's when finished, else the server's running totals.
  const allTotals = footer?.totals ?? transcript.live_totals
  const standing = new Map(footer?.standings.map((s) => [s.player_id, s]))
  const winners = header.seats.filter((s) => standing.get(s.player_id)?.rank === 1)
  const winnerIds = new Set(winners.map((s) => s.player_id))
  const live = !footer
  const seats = footer
    ? [...header.seats].sort(
        (a, b) => (standing.get(a.player_id)?.rank ?? 99) - (standing.get(b.player_id)?.rank ?? 99)
      )
    : header.seats

  const title = live
    ? redacted
      ? 'Game in progress'
      : 'Unfinished game'
    : footer.reason === 'abandoned'
      ? 'Abandoned game'
      : winners.length > 1
        ? `${winners.map((w) => w.name).join(' and ')} tied`
        : winners.length === 1
          ? `${winners[0].name} won`
          : 'Game over'
  const length = footer ? duration(header.started_at, footer.ended_at) : ''
  const facts = [
    shortDate(header.started_at),
    length,
    footer && footer.reason !== 'abandoned' ? (END_REASON[footer.reason] ?? footer.reason) : '',
    `${header.seats.length} players`,
  ].filter(Boolean)

  return (
    <section className={styles.wrap} aria-label="Game summary" data-testid="summary-header">
      <div className={styles.top}>
        <h1 className={styles.title} data-testid="transcript-title">
          {title}
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
          {header.loaded_from_snapshot && <Badge label="FROM SNAPSHOT" variant="warning" />}
        </div>
      </div>
      <p className={styles.facts} data-testid="transcript-facts">
        {facts.join(' · ')}
      </p>

      <details className={styles.details} data-testid="transcript-details">
        <summary className={styles.summary}>Details</summary>
        <dl className={styles.dl}>
          <dt>Game</dt>
          <dd>
            <code>{header.game_id}</code>
          </dd>
          {header.room_code && (
            <>
              <dt>Room</dt>
              <dd>{header.room_code}</dd>
            </>
          )}
          <dt>Started</dt>
          <dd>{formatDateTime(header.started_at)}</dd>
          {footer && (
            <>
              <dt>Ended</dt>
              <dd>
                {formatDateTime(footer.ended_at)}
                {footer.detail ? ` · ${footer.detail}` : ''}
              </dd>
            </>
          )}
          {header.seed !== null && header.seed !== undefined && (
            <>
              <dt>Seed</dt>
              <dd>{header.seed}</dd>
            </>
          )}
          {header.prompt_version && (
            <>
              <dt>Prompt</dt>
              <dd>
                <code>{header.prompt_version}</code>
              </dd>
            </>
          )}
          {header.bench && (
            <>
              <dt>Series</dt>
              <dd>
                <Link to={`/bench/series/${encodeURIComponent(header.bench.series_id)}`}>
                  {header.bench.series_id}
                </Link>{' '}
                ({header.bench.matchup}, seating {header.bench.rotation}
                {header.bench.protocol && <>, protocol {header.bench.protocol}</>}
                {header.bench.track && <>, track {header.bench.track}</>})
              </dd>
            </>
          )}
        </dl>
        <a
          className={styles.download}
          href={transcriptDownloadUrl(header.game_id)}
          download={`${header.game_id}.json`}
          data-testid="download-transcript"
        >
          Download the transcript (JSON)
        </a>
      </details>

      {header.loaded_from_snapshot && (
        <p className={styles.redacted} role="note" data-testid="snapshot-banner">
          This game was loaded from a saved snapshot (test mode), so the record starts mid-game
          rather than at the deal and cannot be replayed from the start.
        </p>
      )}

      {redacted && (
        <p className={styles.redacted} role="note" data-testid="redacted-banner">
          This game is still in progress, so only public information is shown. Prompts, the
          models&apos; private notes and reasons, and players&apos; hands unlock when the game ends.
        </p>
      )}

      <table className={styles.table} data-testid="seat-summary">
        <thead>
          <tr>
            <th className={styles.rank}>{footer ? '#' : 'Seat'}</th>
            <th>Player</th>
            {footer && <th className={styles.num}>Final</th>}
            <th className={styles.num} title="Decisions">
              Moves
            </th>
          </tr>
        </thead>
        <tbody>
          {seats.map((seat, i) => {
            const totals = allTotals?.[seat.player_id]
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
                <td className={styles.player}>
                  <SeatChip seat={seat} winner={winnerIds.has(seat.player_id)} oneLine />
                  {isAi && (
                    <span className={styles.ai}>
                      {(seat.agent_label || seat.model) && (
                        <span className={styles.model}>{seat.agent_label || seat.model}</span>
                      )}
                      <span>
                        <span data-testid={`retries-${seat.player_id}`}>{retries}</span> retries
                      </span>
                      <span className={fallbacks > 0 ? styles.warn : undefined}>
                        <span data-testid={`fallbacks-${seat.player_id}`}>{fallbacks}</span>{' '}
                        fallback{fallbacks === 1 ? '' : 's'}
                      </span>
                      <span title="Tokens in / out">
                        {formatTokens(tin)}/{formatTokens(tout)} tok
                      </span>
                      <span data-testid={`cost-${seat.player_id}`}>
                        {formatCost(totals?.cost_usd ?? null, 4)}
                      </span>
                    </span>
                  )}
                </td>
                {footer && (
                  <td className={styles.num} data-testid={`score-${seat.player_id}`}>
                    {rules.money(s?.score)}
                  </td>
                )}
                <td className={styles.num}>{decisions}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
})
