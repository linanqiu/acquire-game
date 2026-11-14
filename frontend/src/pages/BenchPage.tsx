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
import type { Leaderboard, LeaderboardAgent } from '../types/transcripts'
import styles from './BenchPage.module.css'

function sortAgents(agents: LeaderboardAgent[]): LeaderboardAgent[] {
  return [...agents].sort((a, b) => b.rating - a.rating || b.win_rate - a.win_rate)
}

export function BenchPage() {
  const [params] = useSearchParams()
  const protocol = params.get('protocol') ?? undefined
  const { data, error, loading, reload } = useFetch(
    (signal) => fetchLeaderboard(protocol, signal),
    `leaderboard:${protocol ?? ''}`
  )

  return (
    <PageFrame>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>ACQUIRE BENCH</h1>
          <p className={styles.lede}>
            A public benchmark that compares AI models by having them play full games of Acquire
            under a fixed protocol. Every row links to the games behind it.
          </p>
        </header>

        {loading && !data && !error && <LoadingView label="Loading leaderboard" />}
        {error && !data && <ErrorView error={error} what="leaderboard" onRetry={reload} />}
        {data && <BenchContent board={data} />}
      </div>
    </PageFrame>
  )
}

function BenchContent({ board }: { board: Leaderboard }) {
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
          <span className={styles.protocolName}>{protocol.id}</span>
          {board.updated_at && (
            <span className={styles.muted} title={formatDateTime(board.updated_at)}>
              updated {formatWhen(board.updated_at)}
            </span>
          )}
        </div>
        <p className={styles.protocolDesc}>{protocol.description}</p>
        <dl className={styles.facts}>
          <div>
            <dt>Players per game</dt>
            <dd>{protocol.players}</dd>
          </div>
          <div>
            <dt>Games per matchup</dt>
            <dd>{protocol.games_per_matchup}</dd>
          </div>
          <div>
            <dt>Seeds</dt>
            <dd>{protocol.seeds?.length ?? 0}</dd>
          </div>
        </dl>
      </section>

      {agents.length === 0 ? (
        <section className={styles.empty} data-testid="bench-empty">
          <h2>No results yet</h2>
          <p>
            Nobody has run this protocol on this server. Results are produced by the benchmark
            runner, which plays the games and writes a transcript for each one:
          </p>
          <pre className={styles.code}>python -m bench</pre>
          <p>
            Once a series finishes, models appear here with their win rate, rating and costs, and
            every game can be replayed move by move.
          </p>
        </section>
      ) : (
        <>
          <p className={styles.sample} data-testid="bench-sample-size">
            Based on {minGames === maxGames ? minGames : `${minGames} to ${maxGames}`} games per
            model. Win-rate and rating ranges are the intervals the benchmark reports; where two
            ranges overlap, this sample does not separate the models.
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
                  <tr key={a.agent_id} data-testid={`leaderboard-row-${a.agent_id}`}>
                    <td className={styles.rankCol}>{i + 1}</td>
                    <th scope="row" className={styles.nameCol}>
                      <span className={styles.agentName}>{a.label}</span>
                      {a.model && <span className={styles.model}>{a.model}</span>}
                    </th>
                    <td className={styles.num}>
                      {a.games}
                      <span className={styles.sub}>{a.wins} won</span>
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
            Ranked by rating. Fallback rate: decisions the rules-based player had to make because
            the model failed. Illegal-retry rate: answers the engine rejected and re-asked.
          </p>
        </>
      )}

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
                  <span className={styles.seriesMatchup}>{s.matchup}</span>
                  <span className={styles.seriesMeta}>
                    {s.games} games · started {formatWhen(s.started_at)}
                  </span>
                  <Badge
                    label={s.finished ? 'FINISHED' : 'IN PROGRESS'}
                    variant={s.finished ? 'default' : 'safe'}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
