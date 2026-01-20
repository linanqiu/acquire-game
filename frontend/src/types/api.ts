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
// WebSocket Message Types (Server -> Client)
// =============================================================================

export interface GameStateMessage {
  type: 'game_state'
  board: Record<string, string | null>
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
  phase: 'waiting' | 'playing' | 'game_over'
  players: Record<
    string,
    {
      name: string
      money: number
      stocks: Record<ChainName, number>
      hand_size: number
    }
  >
  tiles_remaining: number
  your_hand?: string[] // Only sent to the owning player
}

export interface LobbyUpdateMessage {
  type: 'lobby_update'
  players: Array<{ player_id: string; name: string; is_bot: boolean }>
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
  scores: Record<string, { name: string; money: number }>
  winner: string | null
  declared_by?: string
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

export interface RoomStateResponse {
  room_code: string
  started: boolean
  players: Array<{ player_id: string; name: string; is_bot: boolean }>
  min_players: number
  max_players: number
}

// =============================================================================
// Trade Types
// =============================================================================

export interface TradeOffer {
  id: string
  from_player_id: string
  to_player_id: string
  offering_stocks: Partial<Record<ChainName, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainName, number>>
  requesting_money: number
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
}
