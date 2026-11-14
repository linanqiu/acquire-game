/**
 * API types matching backend Pydantic models and WebSocket schemas
 */

// Chain names as used by backend (title case)
export type ChainName =
  | 'Luxor'
  | 'Tower'
  | 'American'
  | 'Worldwide'
  | 'Festival'
  | 'Imperial'
  | 'Continental'

export const VALID_CHAINS: ChainName[] = [
  'Luxor',
  'Tower',
  'American',
  'Worldwide',
  'Festival',
  'Imperial',
  'Continental',
]

// =============================================================================
// Tile Playability Types
// =============================================================================

export interface TilePlayabilityInfo {
  playable: boolean
  reason: 'would_merge_safe_chains' | 'would_create_eighth_chain' | null
  permanent: boolean | null
  would_trigger_merger: boolean
}

// =============================================================================
// Seats (humans and AI opponents) - see docs/architecture/seat-contract.md
// =============================================================================

/** What sits in a seat. Older backends omit this and only send `is_bot`. */
export type SeatKind = 'human' | 'bot' | 'llm' | 'scripted'

/** The decision the engine is currently waiting on (public, informational). */
export interface AwaitingDecision {
  player_id: string
  kind: SeatKind
  decision: string
}

/** Why the rules-based bot decided for an LLM seat. */
export type FallbackReason = 'timeout' | 'error' | 'illegal' | 'cap'

/** Per-seat count of decisions the rules-based bot made instead of the AI. */
export interface SeatFallbacks {
  count: number
  last_reason: FallbackReason | null
}

/** One entry of `GET /api/agents/catalog`. */
export interface AgentCatalogEntry {
  id: string
  kind: SeatKind
  label: string
  description: string
  available: boolean
}

/** Player fields shared by lobby updates and room state. */
export interface LobbySeat {
  player_id: string
  name: string
  is_bot: boolean
  kind?: SeatKind
  agent_label?: string | null
}

// =============================================================================
// WebSocket Message Types (Server -> Client)
// =============================================================================

// Game phases as sent by backend
export type GamePhase =
  | 'lobby'
  | 'place_tile'
  | 'found_chain'
  | 'merger'
  | 'stock_disposition'
  | 'buy_stocks'
  | 'game_over'

// Board cell state as sent by backend
export interface BoardCell {
  state: 'empty' | 'played' | 'in_chain'
  chain: ChainName | null
}

export interface GameStateMessage {
  type: 'game_state'
  board: {
    cells: Record<string, BoardCell>
  }
  hotel: {
    chains: Array<{
      name: ChainName
      size: number
      price: number
      stocks_available: number
    }>
    available_stocks: Record<ChainName, number>
    active_chains: ChainName[]
  }
  turn_order: string[]
  current_player: string
  phase: GamePhase
  players: Record<
    string,
    {
      name: string
      money: number
      stocks: Record<ChainName, number>
      hand_size: number
      is_bot?: boolean
      kind?: SeatKind
      agent_label?: string | null
      /** Rules-based-bot takeovers for this seat (absent on older backends). */
      fallbacks?: SeatFallbacks
    }
  >
  tiles_remaining: number
  /** Transcript id (see /games/:gameId); absent on older backends. */
  game_id?: string | null
  your_hand?: string[] // Only sent to the owning player
  tile_playability?: Record<string, TilePlayabilityInfo> // Only sent to the owning player
  end_game_available?: boolean // True when current player can declare end game
  awaiting?: AwaitingDecision | null // Who the engine is waiting on (absent on older backends)
  /** Pending offers addressed to the receiving player (per-player; absent on older backends). */
  incoming_trades?: TradeOffer[]
  /** Pending offers the receiving player has made (per-player; absent on older backends). */
  outgoing_trades?: TradeOffer[]
  /** All pending offers, public (absent on older backends). */
  pending_trades?: TradeOffer[]
}

export interface LobbyUpdateMessage {
  type: 'lobby_update'
  players: LobbySeat[]
  can_start: boolean
}

export interface ChooseChainMessage {
  type: 'choose_chain'
  available_chains: ChainName[]
}

export interface ChooseMergerSurvivorMessage {
  type: 'choose_merger_survivor'
  tied_chains: ChainName[]
}

export interface StockDispositionMessage {
  type: 'stock_disposition_required'
  defunct_chain: ChainName
  surviving_chain: ChainName
  stock_count: number
  available_to_trade: number
}

export interface ErrorMessage {
  type: 'error'
  message: string
}

export interface GameOverMessage {
  type: 'game_over'
  /** Final money per player; `bonuses` / `stock_sales` (end-of-game payouts, already
   * included in `money`) are sent by current backends. */
  scores: Record<string, { name: string; money: number; bonuses?: number; stock_sales?: number }>
  winner: string | null
  declared_by?: string
  /** Transcript id (see /games/:gameId); absent on older backends. */
  game_id?: string | null
}

export interface CanEndGameMessage {
  type: 'can_end_game'
  message: string
}

export interface AllTilesUnplayableMessage {
  type: 'all_tiles_unplayable'
  player_id: string
  player_name: string
  revealed_hand: string[]
  removed_tiles: string[]
  new_tiles_count: number
}

export interface TilesReplacedMessage {
  type: 'tiles_replaced'
  removed_tiles: string[]
  new_hand: string[]
}

export interface TradeProposedMessage {
  type: 'trade_proposed'
  trade: TradeOffer
}

export interface TradeAcceptedMessage {
  type: 'trade_accepted'
  trade_id: string
  from_player: string
  to_player: string
}

export interface TradeRejectedMessage {
  type: 'trade_rejected'
  trade_id: string
  rejected_by: string
}

export interface TradeCanceledMessage {
  type: 'trade_canceled'
  trade_id: string
  canceled_by: string
}

/** The rules-based bot made a decision on behalf of an LLM seat (room + host). */
export interface AgentFallbackMessage {
  type: 'agent_fallback'
  player_id: string
  player_name: string
  agent_label: string
  reason: FallbackReason
  decision: string
  message: string
}

export interface PingMessage {
  type: 'ping'
}

export type WebSocketMessage =
  | GameStateMessage
  | LobbyUpdateMessage
  | ChooseChainMessage
  | ChooseMergerSurvivorMessage
  | StockDispositionMessage
  | ErrorMessage
  | GameOverMessage
  | CanEndGameMessage
  | AllTilesUnplayableMessage
  | TilesReplacedMessage
  | TradeProposedMessage
  | TradeAcceptedMessage
  | TradeRejectedMessage
  | TradeCanceledMessage
  | AgentFallbackMessage
  | PingMessage

// =============================================================================
// Action Payloads (Client -> Server)
// =============================================================================

export interface PlaceTileAction {
  action: 'place_tile'
  tile: string
}

export interface FoundChainAction {
  action: 'found_chain'
  chain: ChainName
}

export interface MergerChoiceAction {
  action: 'merger_choice'
  surviving_chain: ChainName
}

export interface MergerDispositionAction {
  action: 'merger_disposition'
  defunct_chain: ChainName
  disposition: {
    sell: number
    trade: number
    hold: number
  }
}

export interface BuyStocksAction {
  action: 'buy_stocks'
  purchases: Partial<Record<ChainName, number>>
}

export interface EndTurnAction {
  action: 'end_turn'
}

export interface DeclareEndGameAction {
  action: 'declare_end_game'
}

export interface ProposeTradeAction {
  action: 'propose_trade'
  to_player_id: string
  offering_stocks: Partial<Record<ChainName, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainName, number>>
  requesting_money: number
}

export interface AcceptTradeAction {
  action: 'accept_trade'
  trade_id: string
}

export interface RejectTradeAction {
  action: 'reject_trade'
  trade_id: string
}

export interface CancelTradeAction {
  action: 'cancel_trade'
  trade_id: string
}

export type GameAction =
  | PlaceTileAction
  | FoundChainAction
  | MergerChoiceAction
  | MergerDispositionAction
  | BuyStocksAction
  | EndTurnAction
  | DeclareEndGameAction
  | ProposeTradeAction
  | AcceptTradeAction
  | RejectTradeAction
  | CancelTradeAction

// =============================================================================
// HTTP API Types
// =============================================================================

export interface CreateRoomResponse {
  room_code: string
  player_id: string
  session_token: string
  is_host: boolean
}

export interface JoinRoomResponse {
  room_code: string
  player_id: string
  session_token: string
}

export interface AddBotResponse {
  bot_id: string
}

export interface AddSeatRequest {
  agent_id: string
  name?: string
}

export interface AddSeatResponse {
  player_id: string
  name: string
  kind: SeatKind
}

export interface RoomStateResponse {
  room_code: string
  started: boolean
  players: LobbySeat[]
  min_players: number
  max_players: number
}

// =============================================================================
// Trade Types
// =============================================================================

export interface TradeOffer {
  trade_id: string
  from_player_id: string
  to_player_id: string
  offering_stocks: Partial<Record<ChainName, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainName, number>>
  requesting_money: number
  // Note: status is tracked client-side based on WebSocket messages
  // Backend doesn't send a status field in the trade object
}
