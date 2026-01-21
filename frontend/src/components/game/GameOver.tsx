import { useMemo } from 'react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import styles from './GameOver.module.css'

export interface FinalScore {
  playerId: string
  name: string
  cash: number
  bonuses: number
  stockSales: number
  total: number
}

export interface GameOverProps {
  scores: FinalScore[]
  myPlayerId?: string
  onPlayAgain: () => void
  onBackToLobby: () => void
  variant?: 'player' | 'host'
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
}: GameOverProps) {
  const ranks = useMemo(() => calculateRanks(scores), [scores])
  const sortedScores = useMemo(
    () => [...scores].sort((a, b) => b.total - a.total),
    [scores]
  )

  const winners = useMemo(
    () => sortedScores.filter((s) => ranks.get(s.playerId) === 1),
    [sortedScores, ranks]
  )

  const isTie = winners.length > 1
  const myScore = myPlayerId ? scores.find((s) => s.playerId === myPlayerId) : undefined

  return (
    <Card title="GAME OVER">
      <div className={styles.container} data-testid="game-over">
        <div className={styles.winner} data-testid="winner-announcement">
          {isTie ? (
            <>
              <span className={styles.crown}>TIE GAME!</span>
              <p className={styles.winnerNames}>
                {winners.map((w) => w.name).join(' & ')}
              </p>
              <p className={styles.winnerTotal}>${winners[0].total.toLocaleString()} each</p>
            </>
          ) : (
            <>
              <span className={styles.crown}>WINNER</span>
              <p className={styles.winnerNames}>{winners[0].name}</p>
              <p className={styles.winnerTotal}>${winners[0].total.toLocaleString()}</p>
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
                  className={`${styles.rankRow} ${isMe ? styles.you : ''} ${isWinner ? styles.winner : ''}`}
                  data-testid={`rank-${score.playerId}`}
                >
                  <span className={styles.rank}>
                    {isWinner && <span className={styles.crownIcon} aria-label="Winner">&#x1F451;</span>}
                    {rank}.
                  </span>
                  <span className={styles.name}>{score.name}</span>
                  <span className={styles.total}>${score.total.toLocaleString()}</span>
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
                <tr>
                  <td>Cash on hand:</td>
                  <td className={styles.amount}>${myScore.cash.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Final bonuses:</td>
                  <td className={styles.amount}>+${myScore.bonuses.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Stock liquidation:</td>
                  <td className={styles.amount}>+${myScore.stockSales.toLocaleString()}</td>
                </tr>
                <tr className={styles.totalRow}>
                  <td>TOTAL:</td>
                  <td className={styles.amount}>${myScore.total.toLocaleString()}</td>
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
                  <th>Bonuses</th>
                  <th>Stock Sales</th>
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
                      <td>${score.cash.toLocaleString()}</td>
                      <td>+${score.bonuses.toLocaleString()}</td>
                      <td>+${score.stockSales.toLocaleString()}</td>
                      <td className={styles.totalCell}>${score.total.toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className={styles.note}>
              * Defunct stocks worth $0 - only active chains were liquidated
            </p>
          </div>
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
