import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageFrame, LoadingView, ErrorView } from '../components/transcripts/PageFrame'
import { SeatChip } from '../components/transcripts/SeatChip'
import { Badge, type BadgeVariant } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { fetchGames, TranscriptApiError } from '../lib/transcripts'
import { formatDateTime, formatWhen } from '../lib/format'
import type { GameStatus, GameSummary } from '../types/transcripts'
import styles from './GamesPage.module.css'

type Filter = 'all' | 'live' | 'finished' | 'benchmark'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'finished', label: 'Finished' },
  { id: 'benchmark', label: 'Benchmark' },
]

const PAGE_SIZE = 50

const STATUS_VARIANT: Record<GameStatus, BadgeVariant> = {
  live: 'safe',
  finished: 'default',
  abandoned: 'warning',
}

function matches(g: GameSummary, f: Filter) {
  if (f === 'live') return g.status === 'live'
  if (f === 'finished') return g.status === 'finished'
  if (f === 'benchmark') return g.source === 'bench'
  return true
}

export function GamesPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<TranscriptApiError | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const gamesRef = useRef<GameSummary[]>([])
  const source = filter === 'benchmark' ? 'bench' : undefined

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchGames({ source, limit: PAGE_SIZE }, signal)
        if (signal.aborted) return
        gamesRef.current = res.games
        setGames(res.games)
        setNext(res.next ?? null)
      } catch (err) {
        if (signal.aborted) return
        setError(
          err instanceof TranscriptApiError
            ? err
            : new TranscriptApiError('server', 'Unexpected error')
        )
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    },
    [source]
  )

  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [load, nonce])

  const loadMore = async () => {
    if (!next) return
    setLoadingMore(true)
    try {
      const res = await fetchGames({ source, limit: PAGE_SIZE, before: next })
      gamesRef.current = [...gamesRef.current, ...res.games]
      setGames(gamesRef.current)
      setNext(res.next ?? null)
    } catch (err) {
      setError(
        err instanceof TranscriptApiError
          ? err
          : new TranscriptApiError('server', 'Unexpected error')
      )
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = games.filter((g) => matches(g, filter))

  return (
    <PageFrame>
      <div className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.title}>GAMES &amp; TRANSCRIPTS</h1>
          <p className={styles.lede}>
            Every game keeps a full record of every move. For AI players it also keeps exactly what
            the model was shown and what it answered. Pick a game to replay it.
          </p>
        </header>

        <div className={styles.filters} role="tablist" aria-label="Filter games">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={`${styles.filter} ${filter === f.id ? styles.filterActive : ''}`}
              onClick={() => setFilter(f.id)}
              data-testid={`filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
          <button
            className={styles.refresh}
            onClick={() => setNonce((n) => n + 1)}
            data-testid="refresh-games"
          >
            Refresh
          </button>
        </div>

        {loading && games.length === 0 && !error && <LoadingView label="Loading games" />}
        {error && games.length === 0 && (
          <ErrorView error={error} what="game list" onRetry={() => setNonce((n) => n + 1)} />
        )}
        {error && games.length > 0 && (
          <p className={styles.inlineError} role="alert">
            Could not load more: {error.message}
          </p>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className={styles.empty} data-testid="games-empty">
            <p>
              {filter === 'all'
                ? 'No games recorded yet. Finish a game (or run the benchmark) and it will show up here.'
                : `No ${filter} games to show.`}
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <ul className={styles.list} data-testid="games-list">
            {visible.map((g) => (
              <GameRow key={g.game_id} game={g} />
            ))}
          </ul>
        )}

        {next && (
          <div className={styles.more}>
            <Button
              variant="secondary"
              loading={loadingMore}
              onClick={loadMore}
              data-testid="load-more"
            >
              LOAD MORE
            </Button>
          </div>
        )}
      </div>
    </PageFrame>
  )
}

function GameRow({ game }: { game: GameSummary }) {
  const winners = new Set(game.winners)
  const winnerNames = game.seats.filter((s) => winners.has(s.player_id)).map((s) => s.name)
  return (
    <li className={styles.row} data-testid={`game-row-${game.game_id}`} data-status={game.status}>
      <Link to={`/games/${encodeURIComponent(game.game_id)}`} className={styles.rowLink}>
        <div className={styles.rowTop}>
          <span className={styles.badges}>
            <Badge label={game.status.toUpperCase()} variant={STATUS_VARIANT[game.status]} />
            {game.source === 'bench' && <Badge label="BENCH" variant="info" />}
            {game.room_code && <span className={styles.room}>Room {game.room_code}</span>}
          </span>
          <span className={styles.when} title={formatDateTime(game.started_at)}>
            {formatWhen(game.started_at)}
          </span>
        </div>
        <div className={styles.seats}>
          {game.seats.map((s) => (
            <SeatChip key={s.player_id} seat={s} winner={winners.has(s.player_id)} />
          ))}
        </div>
        <div className={styles.rowBottom}>
          {/* A live game has its LIVE badge; the outcome line is for games that have one. */}
          <span data-testid="game-winner">
            {game.status === 'live'
              ? ''
              : winnerNames.length
                ? `Winner: ${winnerNames.join(' & ')}`
                : game.status === 'abandoned'
                  ? 'Abandoned — no winner'
                  : 'No winner recorded'}
          </span>
          <span>{game.turns} turns</span>
        </div>
      </Link>
    </li>
  )
}
