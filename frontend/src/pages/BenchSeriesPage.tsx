import { Link, useParams } from 'react-router-dom'
import { PageFrame, LoadingView, ErrorView } from '../components/transcripts/PageFrame'
import { useFetch } from '../hooks/useFetch'
import { fetchSeries } from '../lib/transcripts'
import { formatNumber } from '../lib/format'
import styles from './BenchSeriesPage.module.css'

export function BenchSeriesPage() {
  const { seriesId = '' } = useParams()
  const { data, error, loading, reload } = useFetch(
    (signal) => fetchSeries(seriesId, signal),
    `series:${seriesId}`
  )

  return (
    <PageFrame>
      <div className={styles.page}>
        <Link to="/bench" className={styles.back}>
          ← Acquire Bench
        </Link>
        {loading && !data && !error && <LoadingView label="Loading series" />}
        {error && !data && <ErrorView error={error} what="series" byId onRetry={reload} />}
        {data && data.series_id === seriesId && (
          <>
            <header className={styles.head}>
              <h1 className={styles.title}>{data.matchup}</h1>
              <p className={styles.meta}>
                Series <code>{data.series_id}</code> · protocol <code>{data.protocol}</code>
                {data.track && <> · track {data.track}</>}
                {data.prompt_version && (
                  <>
                    {' '}
                    · prompt <code>{data.prompt_version}</code>
                  </>
                )}{' '}
                · <span data-testid="series-played">{data.games.length}</span>
                {data.planned ? ` of ${data.planned}` : ''} games played
              </p>
            </header>
            {data.games.length === 0 ? (
              <p className={styles.empty} data-testid="series-no-games">
                No games finished in this series yet.
              </p>
            ) : (
              <ul className={styles.list} data-testid="series-games">
                {data.games.map((g, gi) => (
                  <li
                    key={g.game_id ?? `${g.seed}-${g.rotation}-${gi}`}
                    className={styles.row}
                    data-testid={`series-game-${g.game_id}`}
                  >
                    <div className={styles.rowHead}>
                      <span className={styles.seed}>
                        Seed {g.seed} · seating {g.rotation}
                        {g.status && g.status !== 'completed' && ` · ${g.status}`}
                        {g.seat_order && (
                          <span className={styles.meta}> · seats: {g.seat_order.join(', ')}</span>
                        )}
                      </span>
                      {g.game_id ? (
                        <Link
                          to={`/games/${encodeURIComponent(g.game_id)}`}
                          className={styles.view}
                          data-testid={`series-view-${g.game_id}`}
                        >
                          View transcript →
                        </Link>
                      ) : (
                        <span className={styles.meta}>no transcript</span>
                      )}
                    </div>
                    <ol className={styles.standings}>
                      {[...g.standings]
                        .sort((a, b) => a.rank - b.rank)
                        .map((s) => (
                          <li
                            key={s.player_id}
                            className={`${styles.standing} ${s.rank === 1 ? styles.first : ''}`}
                          >
                            <span className={styles.rank}>{s.rank}.</span>
                            <span className={styles.sname}>
                              {s.name}
                              {s.agent_id && s.agent_id !== s.name && (
                                <span className={styles.meta}> ({s.agent_id})</span>
                              )}
                            </span>
                            <span className={styles.score}>${formatNumber(s.score)}</span>
                          </li>
                        ))}
                    </ol>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PageFrame>
  )
}
