/**
 * Game State Store
 * Zustand store for managing game state, room state, and connection status.
 */

import { create } from 'zustand'
import type {
  ChainName,
  GameStateMessage,
  LobbyUpdateMessage,
  TilePlayabilityInfo,
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

// An optimistic (not yet server-confirmed) action, with the snapshot needed
// to roll the UI back if the server rejects it. (RT-004)
export interface PendingAction {
  id: string
  type: string
  timestamp: number
  snapshot: {
    gameState: GameStateMessage | null
    yourHand: string[]
  }
}

let nextPendingActionId = 0

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
  tilePlayability: Record<string, TilePlayabilityInfo> | null

  // Pending actions
  pendingChainChoice: ChainName[] | null
  pendingMergerChoice: ChainName[] | null
  pendingStockDisposition: {
    defunctChain: ChainName
    survivingChain: ChainName
    stockCount: number
    availableToTrade: number
  } | null

  // Optimistic updates (RT-004)
  pendingActions: PendingAction[]

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

  // Optimistic update actions (RT-004)
  /**
   * Apply a predicted state immediately and track it as pending.
   * Returns the pending action id.
   */
  beginOptimisticAction: (
    type: string,
    optimistic: { gameState?: GameStateMessage; yourHand?: string[] }
  ) => string
  /** Server confirmed (fresh game_state arrived): drop all pending actions. */
  confirmPendingActions: () => void
  /**
   * Server rejected an action: restore the snapshot taken before the
   * oldest pending action and drop all pending actions.
   */
  rollbackPendingActions: () => void
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
  tilePlayability: null,
  pendingChainChoice: null,
  pendingMergerChoice: null,
  pendingStockDisposition: null,
  pendingActions: [],
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
      tilePlayability: message.tile_playability ?? get().tilePlayability,
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
        // Authoritative server state confirms (and overwrites) any optimistic
        // predictions — drop them so a later error can't roll back past it.
        store.confirmPendingActions()
        store.updateGameState(message)
        // Clear pending actions when we get new game state,
        // BUT preserve them if the phase indicates we're still waiting for that action.
        // This handles the race condition where choose_chain arrives before game_state.
        if (message.phase !== 'found_chain') {
          set({ pendingChainChoice: null })
        }
        if (message.phase !== 'merger' && message.phase !== 'stock_disposition') {
          set({ pendingMergerChoice: null, pendingStockDisposition: null })
        }
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

      case 'error':
        // The server rejected an action: undo any optimistic predictions.
        // (The toast for the error itself is shown by the page via the
        // useWebSocket onServerError callback.)
        store.rollbackPendingActions()
        break

      // Other message types can be handled by components via useEffect
    }
  },

  reset: () => set(initialState),

  beginOptimisticAction: (type, optimistic) => {
    const id = `pending-${++nextPendingActionId}`
    set((state) => ({
      gameState: optimistic.gameState ?? state.gameState,
      yourHand: optimistic.yourHand ?? state.yourHand,
      pendingActions: [
        ...state.pendingActions,
        {
          id,
          type,
          timestamp: Date.now(),
          snapshot: {
            gameState: state.gameState,
            yourHand: state.yourHand,
          },
        },
      ],
    }))
    return id
  },

  confirmPendingActions: () => {
    if (get().pendingActions.length > 0) {
      set({ pendingActions: [] })
    }
  },

  rollbackPendingActions: () => {
    const { pendingActions } = get()
    if (pendingActions.length === 0) return
    // Roll back to the state before the oldest unconfirmed action.
    const { snapshot } = pendingActions[0]
    set({
      gameState: snapshot.gameState,
      yourHand: snapshot.yourHand,
      pendingActions: [],
    })
  },
}))
