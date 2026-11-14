/**
 * Game State Store
 * Zustand store for managing game state, room state, and connection status.
 */

import { create } from 'zustand'
import type {
  ChainId,
  GameOverMessage,
  GameStateMessage,
  LobbySeat,
  LobbyUpdateMessage,
  TilePlayabilityInfo,
  TradeOffer,
  AgentFallbackMessage,
  WebSocketMessage,
} from '../types/api'

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Player info in lobby
export type LobbyPlayer = LobbySeat

// Current player's info
export interface CurrentPlayer {
  id: string
  name: string
  token: string
  isHost: boolean
}

/** A trade lifecycle event, surfaced so pages can toast about it. `seq` increments per event. */
export interface TradeEvent {
  seq: number
  kind: 'proposed' | 'accepted' | 'rejected' | 'canceled'
  tradeId: string
  /** The offer the event is about, when known (it is removed from `trades` on resolution). */
  trade?: TradeOffer
  /** Who rejected/canceled (accepted: the recipient). */
  byPlayerId?: string
}

/** The newest `agent_fallback` message, surfaced so pages can toast about it. */
export interface FallbackEvent {
  seq: number
  message: AgentFallbackMessage
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
  tilePlayability: Record<string, TilePlayabilityInfo> | null

  // Player-to-player trading. `trades` = pending offers involving this player
  // (incoming + outgoing); `publicTrades` = every pending offer (host/spectator view).
  trades: TradeOffer[]
  publicTrades: TradeOffer[]
  lastTradeEvent: TradeEvent | null
  lastFallbackEvent: FallbackEvent | null

  /** The final `game_over` message (scores with their breakdown), once the game ended. */
  gameOver: GameOverMessage | null

  // Pending actions
  pendingChainChoice: ChainId[] | null
  pendingMergerChoice: ChainId[] | null
  pendingStockDisposition: {
    defunctChain: ChainId
    survivingChain: ChainId
    stockCount: number
    availableToTrade: number
  } | null

  // Actions
  setConnectionStatus: (status: ConnectionStatus, error?: string) => void
  setRoomCode: (code: string | null) => void
  setCurrentPlayer: (player: CurrentPlayer | null) => void
  updateLobby: (message: LobbyUpdateMessage) => void
  updateGameState: (message: GameStateMessage) => void
  setPendingChainChoice: (chains: ChainId[] | null) => void
  setPendingMergerChoice: (chains: ChainId[] | null) => void
  setPendingStockDisposition: (
    data: {
      defunctChain: ChainId
      survivingChain: ChainId
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
  tilePlayability: null,
  trades: [] as TradeOffer[],
  publicTrades: [] as TradeOffer[],
  lastTradeEvent: null as TradeEvent | null,
  gameOver: null as GameOverMessage | null,
  lastFallbackEvent: null as FallbackEvent | null,
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

  updateGameState: (message) => {
    const patch: Partial<GameStoreState> = {
      gameState: message,
      yourHand: message.your_hand ?? get().yourHand,
      tilePlayability: message.tile_playability ?? get().tilePlayability,
    }
    // When the server includes trade lists they are authoritative (this is also what
    // restores offers after a reconnect). Older backends omit them; then we rely on the
    // trade_* messages alone.
    if (message.incoming_trades || message.outgoing_trades) {
      const byId = new Map<string, TradeOffer>()
      for (const t of [...(message.incoming_trades ?? []), ...(message.outgoing_trades ?? [])]) {
        byId.set(t.trade_id, t)
      }
      patch.trades = [...byId.values()]
    }
    if (message.pending_trades) {
      patch.publicTrades = message.pending_trades
    }
    set(patch)
  },

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
        // Clear pending actions when we get new game state,
        // BUT preserve them if the phase indicates we're still waiting for that action.
        // This handles the race condition where choose_chain arrives before game_state.
        if (message.phase !== 'found_chain') {
          set({ pendingChainChoice: null })
        }
        if (message.phase !== 'merger' && message.phase !== 'stock_disposition') {
          set({ pendingMergerChoice: null, pendingStockDisposition: null })
        } else {
          // The merger goes on after my answer (e.g. another human now disposes of their
          // stock): once the table waits on a different flow decision, my prompt is done
          // and must not stay on screen (it would invite a second, refused answer).
          // Trade responses run beside the flow decision, so they never clear a prompt.
          const awaiting = message.awaiting
          const me = get().currentPlayer?.id
          if (awaiting && me && awaiting.decision !== 'trade_response') {
            const mine = awaiting.player_id === me
            if (!(mine && awaiting.decision === 'choose_survivor')) {
              set({ pendingMergerChoice: null })
            }
            if (!(mine && awaiting.decision === 'stock_disposition')) {
              set({ pendingStockDisposition: null })
            }
          }
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

      case 'trade_proposed': {
        const trade = message.trade
        if (!trade?.trade_id) break
        const others = store.trades.filter((t) => t.trade_id !== trade.trade_id)
        set({
          trades: [...others, trade],
          lastTradeEvent: {
            seq: (store.lastTradeEvent?.seq ?? 0) + 1,
            kind: 'proposed',
            tradeId: trade.trade_id,
            trade,
            byPlayerId: trade.from_player_id,
          },
        })
        break
      }

      case 'trade_accepted':
      case 'trade_rejected':
      case 'trade_canceled': {
        const known = store.trades.find((t) => t.trade_id === message.trade_id)
        const kind =
          message.type === 'trade_accepted'
            ? 'accepted'
            : message.type === 'trade_rejected'
              ? 'rejected'
              : 'canceled'
        const byPlayerId =
          message.type === 'trade_accepted'
            ? message.to_player
            : message.type === 'trade_rejected'
              ? message.rejected_by
              : message.canceled_by
        set({
          trades: store.trades.filter((t) => t.trade_id !== message.trade_id),
          lastTradeEvent: {
            seq: (store.lastTradeEvent?.seq ?? 0) + 1,
            kind,
            tradeId: message.trade_id,
            trade: known,
            byPlayerId,
          },
        })
        break
      }

      case 'game_over':
        set({ gameOver: message })
        break

      case 'agent_fallback':
        set({
          lastFallbackEvent: {
            seq: (store.lastFallbackEvent?.seq ?? 0) + 1,
            message,
          },
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
