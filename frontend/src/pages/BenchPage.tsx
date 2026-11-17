import { Link, useSearchParams } from 'react-router-dom'
import { PageFrame, LoadingView, ErrorView } from '../components/transcripts/PageFrame'
import { RangeBar } from '../components/transcripts/RangeBar'
import { Badge } from '../components/ui/Badge'
import { useFetch } from '../hooks/useFetch'
import { fetchLeaderboard } from '../lib/transcripts'
import {
  formatCost,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatSeconds,
  formatTokens,
  formatWhen,
} from '../lib/format'
import type { BenchTrack, Leaderboard, LeaderboardAgent } from '../types/transcripts'
import { useBrand } from '../ruleset/useRules'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import styles from './BenchPage.module.css'

function sortAgents(agents: LeaderboardAgent[]): LeaderboardAgent[] {
  return [...agents].sort((a, b) => b.rating - a.rating || b.win_rate - a.win_rate)
}

const TRACKS: { id: BenchTrack; label: string; hint: string }[] = [
  { id: 'all', label: 'All tracks', hint: 'every game of this protocol and prompt version' },
  { id: 'vs-baseline', label: 'vs baseline', hint: 'one model against three rules-based bots' },
  { id: 'head-to-head', label: 'head to head', hint: 'models against each other in one game' },
]

function parseTrack(raw: string | null): BenchTrack {
  return raw === 'vs-baseline' || raw === 'head-to-head' ? raw : 'all'
}

export function BenchPage() {
  const brand = useBrand()
  useDocumentTitle(`${brand} Bench`)
  const [params, setParams] = useSearchParams()
  const protocol = params.get('protocol') ?? undefined
  const promptVersion = params.get('prompt_version') ?? undefined
  const track = parseTrack(params.get('track'))
  const { data, error, loading, reload } = useFetch(
    (signal) => fetchLeaderboard({ protocol, promptVersion, track }, signal),
    `leaderboard:${protocol ?? ''}:${promptVersion ?? ''}:${track}`
  )
  const setParam = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })

  return (
    <PageFrame>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title} data-testid="bench-title">
            {brand.toUpperCase()} BENCH
          </h1>
          <p className={styles.lede}>
            AI models ranked by full games of {brand}; every row links to its games.
          </p>
        </header>

        {loading && !data && !error && <LoadingView label="Loading leaderboard" />}
        {error && !data && <ErrorView error={error} what="leaderboard" onRetry={reload} />}
        {data && <BenchContent board={data} track={track} onParam={setParam} />}
      </div>
    </PageFrame>
  )
}

function BenchContent({
  board,
  track,
  onParam,
}: {
  board: Leaderboard
  track: BenchTrack
  onParam: (key: string, value: string | null) => void
}) {
  const agents = sortAgents(board.agents)
  const { protocol } = board
  const gameCounts = agents.map((a) => a.games)
  const minGames = Math.min(...gameCounts)
  const maxGames = Math.max(...gameCounts)
  const ratingLows = agents.map((a) => a.rating_ci?.[0] ?? a.rating)
  const ratingHighs = agents.map((a) => a.rating_ci?.[1] ?? a.rating)
  const rMin = Math.min(...ratingLows)
  const rMax = Math.max(...ratingHighs)

  return (
    <>
      <section className={styles.protocol} data-testid="bench-protocol" aria-label="Protocol">
        <div className={styles.protocolHead}>
          <span className={styles.protocolName} data-testid="bench-protocol-id">
            {protocol.id}
          </span>
          {board.prompt_version && (
            <span className={styles.protocolName} data-testid="bench-prompt-version">
              prompt <code>{board.prompt_version}</code>
            </span>
          )}
          <span className={styles.protocolName} data-testid="bench-track">
            track: {board.track}
          </span>
          {board.updated_at && (
            <span className={styles.muted} title={formatDateTime(board.updated_at)}>
              updated {formatWhen(board.updated_at)}
            </span>
          )}
        </div>
        {/* The numbers on one line; the long description and the caveat behind "About". */}
        <dl className={styles.facts}>
          <div>
            <dt>players</dt>
            <dd>{protocol.players}</dd>
          </div>
          <div>
            <dt>games per matchup</dt>
            <dd>{protocol.games_per_matchup}</dd>
          </div>
          <div>
            <dt>seeds</dt>
            <dd>{protocol.seeds?.length ?? 0}</dd>
          </div>
        </dl>
        <details className={styles.about}>
          <summary>About this protocol</summary>
          <p className={styles.protocolDesc}>{protocol.description}</p>
          <p className={styles.protocolDesc}>
            Results are only comparable within one protocol and prompt version; this table never
            mixes them.
          </p>
        </details>
      </section>

      <div className={styles.controls}>
        <div role="tablist" aria-label="Track" className={styles.tabs}>
          {TRACKS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={track === t.id}
              className={`${styles.tab} ${track === t.id ? styles.tabActive : ''}`}
              title={t.hint}
              onClick={() => onParam('track', t.id === 'all' ? null : t.id)}
              data-testid={`track-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {board.available.prompt_versions.length > 1 && (
          <label className={styles.select}>
            Prompt version{' '}
            <select
              value={board.prompt_version ?? ''}
              onChange={(e) => onParam('prompt_version', e.target.value)}
              data-testid="prompt-version-select"
            >
              {board.available.prompt_versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
        {board.available.protocols.length > 1 && (
          <label className={styles.select}>
            Protocol{' '}
            <select
              value={protocol.id}
              onChange={(e) => {
                onParam('prompt_version', null)
                onParam('protocol', e.target.value)
              }}
              data-testid="protocol-select"
            >
              {board.available.protocols.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {board.warnings.length > 0 && (
        <ul className={styles.warnings} data-testid="bench-warnings">
          {board.warnings.map((w) => (
            <li key={w} role="note">
              {w}
            </li>
          ))}
        </ul>
      )}

      {agents.length === 0 ? (
        <section className={styles.empty} data-testid="bench-empty">
          <h2>No results yet</h2>
          <p>Nobody has run this protocol on this server. The benchmark runner fills this table:</p>
          <pre className={styles.code}>python -m bench</pre>
        </section>
      ) : (
        <>
          <p className={styles.sample} data-testid="bench-sample-size">
            {board.games} games in this table;{' '}
            {minGames === maxGames ? minGames : `${minGames} to ${maxGames}`} games per model.
            Win-rate and rating ranges are the intervals the benchmark reports; where two ranges
            overlap, this sample does not separate the models.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="leaderboard-table">
              <thead>
                <tr>
                  <th className={styles.rankCol}>#</th>
                  <th className={styles.nameCol}>Model</th>
                  <th className={styles.num}>Games</th>
                  <th className={styles.ciCol}>Win rate (interval)</th>
                  <th className={styles.num}>Mean rank</th>
                  <th className={styles.ciCol}>Rating (interval)</th>
                  <th className={styles.num} title="Fallback rate">
                    Fallback rate
                  </th>
                  <th className={styles.num}>Illegal-retry rate</th>
                  <th className={styles.num}>Tokens / game</th>
                  <th className={styles.num}>Cost / game</th>
                  <th className={styles.num}>Median latency</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a, i) => (
                  <tr
                    key={a.agent_id}
                    data-testid={`leaderboard-row-${a.agent_id}`}
                    data-anchor={a.is_anchor ? 'true' : undefined}
                  >
                    <td className={styles.rankCol}>{i + 1}</td>
                    <th scope="row" className={styles.nameCol}>
                      <span className={styles.agentName}>{a.label}</span>
                      {a.is_anchor && (
                        <Badge label="ANCHOR" variant="info" title="Rating anchor, fixed at 1500" />
                      )}
                      {a.model && <span className={styles.model}>{a.model}</span>}
                    </th>
                    <td className={styles.num}>
                      {a.games}
                      <span className={styles.sub}>
                        {a.wins} won
                        {a.seat_games !== a.games && ` · ${a.seat_games} seat-games`}
                      </span>
                    </td>
                    <td className={styles.ciCol} data-testid={`winrate-${a.agent_id}`}>
                      <span className={styles.ciText}>
                        {formatPercent(a.win_rate)}{' '}
                        <span className={styles.muted}>
                          [{formatPercent(a.ci_low)}–{formatPercent(a.ci_high)}]
                        </span>
                      </span>
                      <RangeBar
                        value={a.win_rate}
                        low={a.ci_low}
                        high={a.ci_high}
                        label={`Win rate ${formatPercent(a.win_rate)}, interval ${formatPercent(a.ci_low)} to ${formatPercent(a.ci_high)}`}
                        testId={`winrate-bar-${a.agent_id}`}
                      />
                    </td>
                    <td className={styles.num}>{a.mean_rank.toFixed(2)}</td>
                    <td className={styles.ciCol} data-testid={`rating-${a.agent_id}`}>
                      <span className={styles.ciText}>
                        {formatNumber(a.rating)}{' '}
                        {a.rating_ci && (
                          <span className={styles.muted}>
                            [{formatNumber(a.rating_ci[0])}–{formatNumber(a.rating_ci[1])}]
                          </span>
                        )}
                      </span>
                      {a.rating_ci && (
                        <RangeBar
                          value={a.rating}
                          low={a.rating_ci[0]}
                          high={a.rating_ci[1]}
                          min={rMin}
                          max={rMax}
                          label={`Rating ${formatNumber(a.rating)}, interval ${formatNumber(a.rating_ci[0])} to ${formatNumber(a.rating_ci[1])}`}
                        />
                      )}
                    </td>
                    <td className={styles.num}>{formatPercent(a.fallback_rate, 1)}</td>
                    <td className={styles.num}>{formatPercent(a.retry_rate, 1)}</td>
                    <td className={styles.num}>{formatTokens(a.tokens_per_game)}</td>
                    <td className={styles.num} data-testid={`cost-${a.agent_id}`}>
                      {formatCost(a.cost_per_game)}
                    </td>
                    <td className={styles.num}>{formatSeconds(a.latency_p50_s)}</td>
                    <td className={styles.verdict}>{a.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.footnote}>
            Ranked by rating; the rules-based bot is the anchor (fixed at{' '}
            {formatNumber(board.rating.anchor_rating)}). Win rate and mean rank count seat-games,
            and the three bot seats of a vs-baseline game are not independent, so the bot&apos;s
            interval is optimistic. Fallback rate: decisions the rules-based player had to make
            because the model failed. Illegal-retry rate: answers the engine rejected and re-asked.
          </p>
        </>
      )}

      {/* With no results at all, "No results yet" above has said it. */}
      {(agents.length > 0 || board.series.length > 0) && (
        <section aria-label="Series" className={styles.seriesSection}>
          <h2 className={styles.h2}>SERIES</h2>
          {board.series.length === 0 ? (
            <p className={styles.muted} data-testid="series-empty">
              No series have been run.
            </p>
          ) : (
            <ul className={styles.seriesList} data-testid="series-list">
              {board.series.map((s) => (
                <li key={s.series_id}>
                  <Link
                    to={`/bench/series/${encodeURIComponent(s.series_id)}`}
                    className={styles.seriesRow}
                    data-testid={`series-link-${s.series_id}`}
                  >
                    <span className={styles.seriesMatchup}>
                      {s.matchup}
                      {s.track && <span className={styles.model}>{s.track}</span>}
                    </span>
                    <span className={styles.seriesMeta}>
                      {s.games}
                      {s.planned ? ` of ${s.planned}` : ''} games played · started{' '}
                      {formatWhen(s.started_at)}
                    </span>
                    <Badge
                      label={s.finished ? 'FINISHED' : 'IN PROGRESS'}
                      variant={s.finished ? 'default' : 'safe'}
                    />
                    <Badge
                      label={s.full_protocol ? 'FULL PROTOCOL' : 'PARTIAL RUN'}
                      variant={s.full_protocol ? 'info' : 'warning'}
                      title={
                        s.full_protocol
                          ? 'Ran every game of the protocol'
                          : 'Fewer games than the protocol prescribes; results are indicative only'
                      }
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}
