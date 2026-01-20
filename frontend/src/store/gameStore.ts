/**
 * Game State Store
 * Zustand store for managing game state, room state, and connection status.
 */

import { create } from 'zustand'
import type {
  ChainName,
  GameStateMessage,
  LobbyUpdateMessage,
  WebSocketMessage,
} from '../types/api'

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Player info in lobby
export interface LobbyPlayer {
  player_id: string
  name: string
  is_bot: boolean
}

// Current player's info
export interface CurrentPlayer {
  id: string
  name: string
  token: string
  isHost: boolean
}

// Game store state
export interface GameStoreState {
  // Connection
  connectionStatus: ConnectionStatus
  connectionError: string | null

  // Room/Lobby
  roomCode: string | null
  currentPlayer: CurrentPlayer | null
  lobbyPlayers: LobbyPlayer[]
  canStart: boolean

  // Game state (from server)
  gameState: GameStateMessage | null
  yourHand: string[]

  // Pending actions
  pendingChainChoice: ChainName[] | null
  pendingMergerChoice: ChainName[] | null
  pendingStockDisposition: {
    defunctChain: ChainName
    survivingChain: ChainName
    stockCount: number
    availableToTrade: number
  } | null

  // Actions
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void
  setRoomCode: (code: string | null) => void
  setCurrentPlayer: (player: CurrentPlayer | null) => void
  updateLobby: (message: LobbyUpdateMessage) => void
  updateGameState: (message: GameStateMessage) => void
  setPendingChainChoice: (chains: ChainName[] | null) => void
  setPendingMergerChoice: (chains: ChainName[] | null) => void
  setPendingStockDisposition: (
    data: {
      defunctChain: ChainName
      survivingChain: ChainName
      stockCount: number
      availableToTrade: number
    } | null
  ) => void
  handleMessage: (message: WebSocketMessage) => void
  reset: () => void
}

const initialState = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  connectionError: null,
  roomCode: null,
  currentPlayer: null,
  lobbyPlayers: [],
  canStart: false,
  gameState: null,
  yourHand: [],
  pendingChainChoice: null,
  pendingMergerChoice: null,
  pendingStockDisposition: null,
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...initialState,

  setConnectionStatus: (status, error) =>
    set({ connectionStatus: status, connectionError: error ?? null }),

  setRoomCode: (code) => set({ roomCode: code }),

  setCurrentPlayer: (player) => set({ currentPlayer: player }),

  updateLobby: (message) =>
    set({
      lobbyPlayers: message.players,
      canStart: message.can_start,
    }),

  updateGameState: (message) =>
    set({
      gameState: message,
      yourHand: message.your_hand ?? get().yourHand,
    }),

  setPendingChainChoice: (chains) => set({ pendingChainChoice: chains }),

  setPendingMergerChoice: (chains) => set({ pendingMergerChoice: chains }),

  setPendingStockDisposition: (data) => set({ pendingStockDisposition: data }),

  handleMessage: (message) => {
    const store = get()

    switch (message.type) {
      case 'lobby_update':
        store.updateLobby(message)
        break

      case 'game_state':
        store.updateGameState(message)
        // Clear pending actions when we get new game state
        set({
          pendingChainChoice: null,
          pendingMergerChoice: null,
          pendingStockDisposition: null,
        })
        break

      case 'choose_chain':
        store.setPendingChainChoice(message.available_chains)
        break

      case 'choose_merger_survivor':
        store.setPendingMergerChoice(message.tied_chains)
        break

      case 'stock_disposition_required':
        store.setPendingStockDisposition({
          defunctChain: message.defunct_chain,
          survivingChain: message.surviving_chain,
          stockCount: message.stock_count,
          availableToTrade: message.available_to_trade,
        })
        break

      case 'tiles_replaced':
        set({ yourHand: message.new_hand })
        break

      // Other message types can be handled by components via useEffect
    }
  },

  reset: () => set(initialState),
}))
