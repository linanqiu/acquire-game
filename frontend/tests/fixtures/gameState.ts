import type { Player, GameState, Board, ChainName, Stocks } from '@/types'

export const CHAIN_NAMES: ChainName[] = [
  'luxor',
  'tower',
  'american',
  'festival',
  'worldwide',
  'continental',
  'imperial',
]

export const createEmptyStocks = (): Stocks => ({
  luxor: 0,
  tower: 0,
  american: 0,
  festival: 0,
  worldwide: 0,
  continental: 0,
  imperial: 0,
})

export const createMockPlayer = (overrides?: Partial<Player>): Player => ({
  id: 'player-1',
  name: 'Test Player',
  cash: 6000,
  stocks: createEmptyStocks(),
  tiles: ['1A', '2B', '3C'],
  ...overrides,
})

export const createEmptyBoard = (): Board => {
  const board: Board = {}
  for (let row = 1; row <= 9; row++) {
    for (let col = 0; col < 12; col++) {
      const colLetter = String.fromCharCode('A'.charCodeAt(0) + col)
      board[`${row}${colLetter}`] = null
    }
  }
  return board
}

export const createMockGameState = (overrides?: Partial<GameState>): GameState => ({
  phase: 'place_tile',
  currentPlayer: 0,
  players: [createMockPlayer()],
  board: createEmptyBoard(),
  chains: {},
  tilePool: 100,
  ...overrides,
})

// Seeded random for deterministic tests
export const seededRandom = (seed: number) => {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}
