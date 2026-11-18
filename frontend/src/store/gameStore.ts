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
  TradeLifecycleMessage,
  TradeOffer,
  AgentFallbackMessage,
  ChatMessage,
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
  isHost: boolean
}

/**
 * A public trade event (an offer or its answer): every page gets every one, whoever the two
 * players are. `seq` is the engine event's number, so the same event received twice (as a
 * message and again in a state's `trade_log`) is one event.
 */
export interface TradeEvent {
  seq: number
  kind: 'proposed' | 'accepted' | 'rejected' | 'canceled'
  tradeId: string
  /** The offer the event is about, when known (it is removed from `trades` on resolution). */
  trade?: TradeOffer
  /** Who rejected/canceled (accepted: the recipient). */
  byPlayerId?: string
  /** Proposer and recipient: from the message itself, so the event is usable even
   *  when this page never saw the offer (an AI seat can answer before it arrives). */
  fromPlayerId?: string
  toPlayerId?: string
  /** Why an offer was cancelled: `cancelled` (withdrawn) or `no_longer_valid`. */
  reason?: string
  /**
   * False for what had already happened when this page first received the game (history:
   * listed in the activity, never announced). True for what happens while the page is open,
   * including what it missed while its connection was down.
   */
  live: boolean
}

/** Trade events kept for the activity list. */
export const TRADE_LOG_KEEP = 20

const TRADE_KIND = {
  trade_proposed: 'proposed',
  trade_accepted: 'accepted',
  trade_rejected: 'rejected',
  trade_canceled: 'canceled',
} as const

/** The offer a trade message is about: a proposal's own, else the one the answer names. */
function tradeIdOf(m: TradeLifecycleMessage): string | undefined {
  return m.type === 'trade_proposed'
    ? m.trade?.trade_id
    : (m.trade_id ?? m.trade?.trade_id ?? undefined)
}

/** The store's event for a trade message; null when the message names no offer. */
function tradeEventOf(
  m: TradeLifecycleMessage,
  seq: number,
  live: boolean,
  known?: TradeOffer
): TradeEvent | null {
  const tradeId = tradeIdOf(m)
  if (!tradeId) return null
  const trade = m.trade?.trade_id === tradeId ? m.trade : known
  const fromPlayerId = trade?.from_player_id ?? m.from_player ?? undefined
  const toPlayerId = trade?.to_player_id ?? m.to_player ?? undefined
  const byPlayerId =
    m.type === 'trade_proposed'
      ? fromPlayerId
      : m.type === 'trade_accepted'
        ? toPlayerId
        : m.type === 'trade_rejected'
          ? m.rejected_by
          : m.canceled_by
  return {
    seq,
    kind: TRADE_KIND[m.type],
    tradeId,
    trade,
    byPlayerId,
    fromPlayerId,
    toPlayerId,
    reason: m.type === 'trade_canceled' ? m.reason : undefined,
    live,
  }
}

function appendTradeEvents(log: TradeEvent[], events: TradeEvent[]): TradeEvent[] {
  const have = new Set(log.map((e) => e.seq))
  const fresh = events.filter((e) => !have.has(e.seq))
  if (fresh.length === 0) return log
  return [...log, ...fresh].sort((a, b) => a.seq - b.seq).slice(-TRADE_LOG_KEEP)
}

/** The newest `agent_fallback` message, surfaced so pages can toast about it. */
export interface FallbackEvent {
  seq: number
  message: AgentFallbackMessage
}

/** `prev` when `next` has the same content (JSON), so unchanged parts keep their identity. */
function same<T>(prev: T | undefined, next: T): T {
  if (prev === undefined || prev === null || next === undefined || next === null) return next
  if (prev === next) return prev
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

/**
 * `next` with every part (board, hotel, players, mergers, ruleset...) whose content did not
 * change since `prev` kept as the previous object. Memoised views (the board and its squares,
 * derived lists) then skip the work for what did not change: a bot buying shares does not
 * redraw the board (BL-020).
 */
export function shareUnchanged(
  prev: GameStateMessage | null,
  next: GameStateMessage
): GameStateMessage {
  if (!prev) return next
  const before = prev as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...next }
  for (const [key, value] of Object.entries(out)) {
    if (value !== null && typeof value === 'object') out[key] = same(before[key], value)
  }
  return out as unknown as GameStateMessage
}

/** The store update for a `game_state` message: state, hand, playability and trades. */
function gameStatePatch(
  current: GameStoreState,
  incoming: GameStateMessage
): Partial<GameStoreState> {
  const message = shareUnchanged(current.gameState, incoming)
  const patch: Partial<GameStoreState> = {
    gameState: message,
    yourHand: message.your_hand ? same(current.yourHand, message.your_hand) : current.yourHand,
    tilePlayability: message.tile_playability
      ? same(current.tilePlayability ?? undefined, message.tile_playability)
      : current.tilePlayability,
  }
  // A player's game_state carries its trade lists, which are authoritative (this is also
  // what restores offers after a reconnect). The host's has only the public list.
  if (message.incoming_trades || message.outgoing_trades) {
    const byId = new Map<string, TradeOffer>()
    for (const t of [...(message.incoming_trades ?? []), ...(message.outgoing_trades ?? [])]) {
      byId.set(t.trade_id, t)
    }
    patch.trades = same(current.trades, [...byId.values()])
  }
  if (message.pending_trades) {
    patch.publicTrades = same(current.publicTrades, message.pending_trades)
  }
  if (message.trade_log?.length) {
    // Events this page has not seen as messages. With a game already on the page they
    // happened while the socket was down (announce them); on the first state they are
    // what came before (history).
    const live = current.gameState !== null
    const events = message.trade_log
      .filter((m) => typeof m.seq === 'number')
      .map((m) => tradeEventOf(m, m.seq as number, live))
      .filter((e): e is TradeEvent => e !== null)
    const tradeLog = appendTradeEvents(current.tradeLog, events)
    if (tradeLog !== current.tradeLog) {
      patch.tradeLog = tradeLog
      patch.lastTradeEvent = tradeLog[tradeLog.length - 1]
    }
  }
  return patch
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

  // Player-to-player trading. Offers are public: `publicTrades` = every pending offer at
  // the table; `trades` = the ones involving this player (incoming + outgoing).
  trades: TradeOffer[]
  publicTrades: TradeOffer[]
  /** Recent trade events (offers and answers at the whole table), oldest first. */
  tradeLog: TradeEvent[]
  /** The newest entry of `tradeLog`. */
  lastTradeEvent: TradeEvent | null
  tradeEventAnnouncedSeq: number
  lastFallbackEvent: FallbackEvent | null

  /** Public table chat, oldest first (deduplicated by id, at most CHAT_KEEP). */
  chatMessages: ChatMessage[]
  /** Highest id of the chat history received on connect (0 before any): already said. */
  chatHistoryId: number

  /** The final `game_over` message (scores with their breakdown), once the game ended. */
  gameOver: GameOverMessage | null

  // Pending actions
  pendingChainChoice: ChainId[] | null
  pendingMergerChoice: ChainId[] | null
  /** Same-size defunct chains I must put in order (I placed the merging tile). */
  pendingMergerOrder: { tiedChains: ChainId[]; survivingChain: ChainId } | null
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

/** Chat messages kept in the store (the server re-sends its last 100 on reconnect). */
export const CHAT_KEEP = 200

/** `current` plus `incoming`, deduplicated by id and ordered by id. */
export function mergeChat(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<number, ChatMessage>()
  for (const m of current) byId.set(m.id, m)
  for (const m of incoming) if (m && typeof m.id === 'number') byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP)
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
  tradeLog: [] as TradeEvent[],
  lastTradeEvent: null as TradeEvent | null,
  /** `seq` of the newest trade event already announced (a toast). Kept here, not in the
   *  page, so a page that mounts or remounts after the event still announces it once. */
  tradeEventAnnouncedSeq: 0,
  gameOver: null as GameOverMessage | null,
  lastFallbackEvent: null as FallbackEvent | null,
  chatMessages: [] as ChatMessage[],
  chatHistoryId: 0,
  pendingChainChoice: null,
  pendingMergerChoice: null,
  pendingMergerOrder: null,
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

  updateGameState: (message) => set(gameStatePatch(get(), message)),

  setPendingChainChoice: (chains) => set({ pendingChainChoice: chains }),

  setPendingMergerChoice: (chains) => set({ pendingMergerChoice: chains }),

  setPendingStockDisposition: (data) => set({ pendingStockDisposition: data }),

  handleMessage: (message) => {
    const store = get()

    switch (message.type) {
      case 'lobby_update':
        store.updateLobby(message)
        break

      case 'game_state': {
        // One store update (so one render) per state: the state and the prompts it ends.
        const patch = gameStatePatch(store, message)
        // Clear pending actions when we get new game state,
        // BUT preserve them if the phase indicates we're still waiting for that action.
        // This handles the race condition where choose_chain arrives before game_state.
        if (message.phase !== 'found_chain') {
          patch.pendingChainChoice = null
        }
        if (message.phase !== 'merger' && message.phase !== 'stock_disposition') {
          patch.pendingMergerChoice = null
          patch.pendingMergerOrder = null
          patch.pendingStockDisposition = null
        } else {
          // The merger goes on after my answer (e.g. another human now disposes of their
          // stock): once the table waits on a different flow decision, my prompt is done
          // and must not stay on screen (it would invite a second, refused answer).
          // Trade responses run beside the flow decision, so they never clear a prompt.
          const awaiting = message.awaiting
          const me = store.currentPlayer?.id
          if (awaiting && me && awaiting.decision !== 'trade_response') {
            const mine = awaiting.player_id === me
            if (!(mine && awaiting.decision === 'choose_survivor')) {
              patch.pendingMergerChoice = null
            }
            if (!(mine && awaiting.decision === 'choose_defunct_order')) {
              patch.pendingMergerOrder = null
            }
            if (!(mine && awaiting.decision === 'stock_disposition')) {
              patch.pendingStockDisposition = null
            }
          }
        }
        set(patch)
        break
      }

      case 'choose_chain':
        store.setPendingChainChoice(message.available_chains)
        break

      case 'choose_merger_survivor':
        store.setPendingMergerChoice(message.tied_chains)
        break

      case 'choose_merger_order':
        set({
          pendingMergerOrder: {
            tiedChains: message.tied_chains,
            survivingChain: message.surviving_chain,
          },
        })
        break

      case 'stock_disposition_required':
        store.setPendingStockDisposition({
          defunctChain: message.defunct_chain,
          survivingChain: message.surviving_chain,
          stockCount: message.stock_count,
          availableToTrade: message.available_to_trade,
        })
        break

      case 'trade_proposed':
      case 'trade_accepted':
      case 'trade_rejected':
      case 'trade_canceled': {
        const proposed = message.type === 'trade_proposed'
        const id = tradeIdOf(message)
        if (!id) break
        const known =
          store.publicTrades.find((t) => t.trade_id === id) ??
          store.trades.find((t) => t.trade_id === id)
        const lastSeq = store.tradeLog[store.tradeLog.length - 1]?.seq ?? 0
        const event = tradeEventOf(
          message,
          typeof message.seq === 'number' ? message.seq : lastSeq + 1,
          true,
          known
        )
        if (!event) break
        // The lists: an offer joins them, an answered one leaves. Every offer is public;
        // `trades` keeps the ones this player is part of.
        const me = store.currentPlayer?.id
        const without = (list: TradeOffer[]) => list.filter((t) => t.trade_id !== id)
        const patch: Partial<GameStoreState> = {
          trades: without(store.trades),
          publicTrades: without(store.publicTrades),
        }
        if (proposed) {
          const trade = message.trade
          patch.publicTrades = [...patch.publicTrades!, trade]
          if (!me || trade.from_player_id === me || trade.to_player_id === me) {
            patch.trades = [...patch.trades!, trade]
          }
        }
        const tradeLog = appendTradeEvents(store.tradeLog, [event])
        if (tradeLog !== store.tradeLog) {
          patch.tradeLog = tradeLog
          patch.lastTradeEvent = tradeLog[tradeLog.length - 1]
        }
        set(patch)
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

      case 'chat_message':
        set({ chatMessages: mergeChat(store.chatMessages, [message.message]) })
        break

      case 'chat_history':
        set({
          chatMessages: mergeChat(store.chatMessages, message.messages ?? []),
          chatHistoryId: Math.max(
            store.chatHistoryId,
            ...(message.messages ?? []).map((m: ChatMessage) => m.id)
          ),
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
