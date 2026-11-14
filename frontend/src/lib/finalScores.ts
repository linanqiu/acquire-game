import type { FinalScore } from '../components/game/GameOver'
import type { GameOverMessage, GameStateMessage } from '../types/api'

/**
 * Final standings for the game-over screen. Final money comes from the game state;
 * the end-of-game breakdown (bonuses, stock sales) from the server's `game_over`
 * message when it has been received. Without it the breakdown is left undefined
 * (shown as unknown) rather than reported as $0.
 */
export function buildFinalScores(
  gameState: GameStateMessage | null,
  gameOver: GameOverMessage | null
): FinalScore[] {
  if (!gameState) return []
  return Object.entries(gameState.players).map(([id, p]) => {
    const s = gameOver?.scores?.[id]
    const known = s?.bonuses !== undefined && s?.stock_sales !== undefined
    const bonuses = known ? s!.bonuses : undefined
    const stockSales = known ? s!.stock_sales : undefined
    return {
      playerId: id,
      name: p.name,
      cash: known ? p.money - (bonuses ?? 0) - (stockSales ?? 0) : p.money,
      bonuses,
      stockSales,
      total: p.money,
    }
  })
}
