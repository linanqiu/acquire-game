import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import styles from './GameOver.module.css'
import { useRules } from '../../ruleset/useRules'
import { SeatKindBadge } from './SeatKindBadge'
import type { SeatKind } from '../../types/api'

export interface FinalScore {
  playerId: string
  name: string
  /** Seat kind and model label, for the seat badge (omitted: no badge). */
  kind?: SeatKind
  agentLabel?: string | null
  /** Cash before the end-of-game payouts (equals `total` when the breakdown is unknown). */
  cash: number
  /** Omit both when the server only reports final cash (bonuses and stock sales are then
   *  already included in `cash`/`total` and no breakdown is shown). */
  bonuses?: number
  stockSales?: number
  total: number
}

export interface GameOverProps {
  scores: FinalScore[]
  myPlayerId?: string
  onPlayAgain: () => void
  onBackToLobby: () => void
  variant?: 'player' | 'host'
  /** Transcript id; when present a "View full transcript" link is shown. */
  gameId?: string | null
}

function calculateRanks(scores: FinalScore[]): Map<string, number> {
  const sorted = [...scores].sort((a, b) => b.total - a.total)
  const ranks = new Map<string, number>()

  let currentRank = 1
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].total < sorted[i - 1].total) {
      currentRank = i + 1
    }
    ranks.set(sorted[i].playerId, currentRank)
  }

  return ranks
}

export function GameOver({
  scores,
  myPlayerId,
  onPlayAgain,
  onBackToLobby,
  variant = 'player',
  gameId,
}: GameOverProps) {
  const rules = useRules()
  const ranks = useMemo(() => calculateRanks(scores), [scores])
  const sortedScores = useMemo(() => [...scores].sort((a, b) => b.total - a.total), [scores])

  const winners = useMemo(
    () => sortedScores.filter((s) => ranks.get(s.playerId) === 1),
    [sortedScores, ranks]
  )

  const isTie = winners.length > 1
  const myScore = myPlayerId ? scores.find((s) => s.playerId === myPlayerId) : undefined
  const hasBreakdown = scores.every((s) => s.bonuses !== undefined && s.stockSales !== undefined)

  return (
    <Card title="GAME OVER">
      <div className={styles.container} data-testid="game-over">
        <div className={styles.winner} data-testid="winner-announcement">
          {isTie ? (
            <>
              <span className={styles.crown}>TIE GAME!</span>
              <p className={styles.winnerNames}>{winners.map((w) => w.name).join(' & ')}</p>
              <p className={styles.winnerTotal}>{rules.money(winners[0].total)} each</p>
            </>
          ) : (
            <>
              <span className={styles.crown}>WINNER</span>
              <p className={styles.winnerNames}>{winners[0].name}</p>
              <p className={styles.winnerTotal}>{rules.money(winners[0].total)}</p>
            </>
          )}
        </div>

        <div className={styles.rankings}>
          <h3 className={styles.sectionTitle}>FINAL STANDINGS</h3>
          <div className={styles.rankList} data-testid="rankings">
            {sortedScores.map((score, idx) => {
              const rank = ranks.get(score.playerId) || idx + 1
              const isWinner = rank === 1
              const isMe = score.playerId === myPlayerId

              return (
                <div
                  key={score.playerId}
                  className={`${styles.rankRow} ${isMe ? styles.you : ''} ${isWinner ? styles.rankWinner : ''}`}
                  data-testid={`rank-${score.playerId}`}
                >
                  <span className={styles.rank}>
                    {isWinner && (
                      <span className={styles.crownIcon} aria-label="Winner">
                        &#x1F451;
                      </span>
                    )}
                    {rank}.
                  </span>
                  <span className={styles.name}>
                    {score.name}
                    <SeatKindBadge
                      playerId={score.playerId}
                      kind={score.kind ?? 'human'}
                      agentLabel={score.agentLabel}
                      playerName={score.name}
                    />
                  </span>
                  <span className={styles.total}>{rules.money(score.total)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {variant === 'player' && myScore && (
          <div className={styles.breakdown} data-testid="breakdown">
            <h3 className={styles.sectionTitle}>YOUR BREAKDOWN</h3>
            <table className={styles.breakdownTable}>
              <tbody>
                {hasBreakdown ? (
                  <>
                    <tr>
                      <td>Cash on hand:</td>
                      <td className={styles.amount}>{rules.money(myScore.cash)}</td>
                    </tr>
                    <tr>
                      <td>Final bonuses:</td>
                      <td className={styles.amount} data-testid="breakdown-bonuses">
                        +{rules.money(myScore.bonuses ?? 0)}
                      </td>
                    </tr>
                    <tr>
                      <td>{rules.theme.stock_label} sold:</td>
                      <td className={styles.amount} data-testid="breakdown-stock-sales">
                        +{rules.money(myScore.stockSales ?? 0)}
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td>Final cash (bonuses and {rules.theme.share_noun} sales included):</td>
                    <td className={styles.amount}>{rules.money(myScore.cash)}</td>
                  </tr>
                )}
                <tr className={styles.totalRow}>
                  <td>TOTAL:</td>
                  <td className={styles.amount}>{rules.money(myScore.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {variant === 'host' && (
          <div className={styles.fullBreakdown} data-testid="full-breakdown">
            <h3 className={styles.sectionTitle}>FULL BREAKDOWN</h3>
            <table className={styles.fullTable}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Cash</th>
                  {hasBreakdown && <th>Bonuses</th>}
                  {hasBreakdown && <th>{rules.theme.stock_label} sold</th>}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedScores.map((score) => {
                  const rank = ranks.get(score.playerId) || 0
                  const isWinner = rank === 1

                  return (
                    <tr key={score.playerId} className={isWinner ? styles.winnerRow : ''}>
                      <td>{score.name}</td>
                      <td>{rules.money(score.cash)}</td>
                      {hasBreakdown && <td>+{rules.money(score.bonuses ?? 0)}</td>}
                      {hasBreakdown && <td>+{rules.money(score.stockSales ?? 0)}</td>}
                      <td className={styles.totalCell}>{rules.money(score.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className={styles.note}>
              * Shares of defunct {rules.theme.chain_noun_plural} are worth {rules.money(0)}: only
              active {rules.theme.chain_noun_plural} were liquidated
            </p>
          </div>
        )}

        {gameId && (
          <Link
            to={`/games/${encodeURIComponent(gameId)}`}
            className={styles.transcriptLink}
            data-testid="view-transcript-link"
          >
            View full transcript
          </Link>
        )}

        <div className={styles.actions}>
          <Button onClick={onPlayAgain} data-testid="play-again">
            PLAY AGAIN
          </Button>
          <Button variant="secondary" onClick={onBackToLobby} data-testid="back-to-lobby">
            BACK TO LOBBY
          </Button>
        </div>
      </div>
    </Card>
  )
}
