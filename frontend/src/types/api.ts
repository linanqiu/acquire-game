/**
 * API types matching backend Pydantic models and WebSocket schemas
 */

import type { ChainId, Ruleset } from './ruleset'

// Chain ids are opaque strings defined by the game's ruleset (`ruleset.chains[].id`).
export type { ChainId, Ruleset }

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

/** What sits in a seat. (`is_bot` is still sent too; transcripts written before `kind` existed only have that.) */
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
  chain: ChainId | null
}

export interface GameStateMessage {
  type: 'game_state'
  board: {
    cells: Record<string, BoardCell>
  }
  hotel: {
    chains: Array<{
      name: ChainId
      size: number
      price: number
      stocks_available: number
      /** Chain colour (current backends; the ruleset is authoritative). */
      color?: string
    }>
    available_stocks: Record<ChainId, number>
    active_chains: ChainId[]
  }
  turn_order: string[]
  current_player: string
  phase: GamePhase
  players: Record<
    string,
    {
      name: string
      money: number
      stocks: Record<ChainId, number>
      hand_size: number
      is_bot?: boolean
      kind?: SeatKind
      agent_label?: string | null
      /** Rules-based-bot takeovers for this seat. */
      fallbacks?: SeatFallbacks
      /** Shares at current prices (engine calculator; defunct chains count 0). */
      stock_value?: number
      /** money + stock_value. */
      net_worth?: number
      /** Competition rank by net worth (ties share a rank: 1, 1, 3). */
      rank?: number
    }
  >
  tiles_remaining: number
  /** Transcript id (see /games/:gameId). */
  game_id?: string | null
  your_hand?: string[] // Only sent to the owning player
  tile_playability?: Record<string, TilePlayabilityInfo> // Only sent to the owning player
  end_game_available?: boolean // True when current player can declare end game
  awaiting?: AwaitingDecision | null // Who the engine is waiting on
  /** Pending offers addressed to the receiving player (player sockets only). */
  incoming_trades?: TradeOffer[]
  /** Pending offers the receiving player has made (player sockets only). */
  outgoing_trades?: TradeOffer[]
  /** All pending offers, public. */
  pending_trades?: TradeOffer[]
  /** The last trade messages (offers and answers, public), oldest first: what a page that
   *  was not connected when they were sent still shows. */
  trade_log?: TradeLifecycleMessage[]
  /** The game's ruleset (until it arrives, the server's configured one applies). */
  ruleset?: Ruleset
  /** Majority/minority holders of every active chain (engine calculator). */
  chain_holders?: Record<ChainId, ChainHolders>
  /** Every merger of the game so far, oldest first (from the engine's events). */
  mergers?: MergerRecord[]
}

/** One holder of a chain; `role`/amounts are what the engine pays if it were bought out now. */
export interface ChainHolder {
  player_id: string
  shares: number
  role: 'majority' | 'minority' | null
  /** Another holder shares this role (the bonus is split). */
  tied: boolean
  majority: number
  minority: number
  /** majority + minority */
  bonus: number
}

export interface ChainHolders {
  size: number
  price: number
  majority_bonus: number
  minority_bonus: number
  /** Most shares first; seat order breaks ties. */
  holders: ChainHolder[]
}

export interface MergerDispositionRecord {
  player_id: string
  sell: number
  trade: number
  hold: number
  sale_proceeds: number
  survivor_shares_received: number
}

export interface MergerDefunctRecord {
  chain: ChainId
  /** Size and share price when it was bought. */
  size: number
  price: number
  /** Bonuses as paid (largest first); null while it waits its turn in a multi-chain merger. */
  bonuses: Array<{ player_id: string; majority: number; minority: number }> | null
  dispositions: MergerDispositionRecord[]
  /** Stockholders still to decide on this chain, in order. */
  waiting_on: string[]
}

export interface MergerRecord {
  /** Event seq of `merger_started`: a stable id. */
  seq: number
  /** Who placed the merging tile. */
  player_id: string | null
  tile: string | null
  survivor: ChainId
  /** Chain sizes before the merger. */
  sizes: Record<ChainId, number>
  defunct: MergerDefunctRecord[]
  /** Survivor size after the merger; null while in progress. */
  survivor_size: number | null
  complete: boolean
  /** The survivor as it will be after the merger (engine); null once complete. */
  survivor_after?: SurvivorAfter | null
}

/** A survivor holder after the merger: shares now (trades made in this merger included). */
export interface SurvivorAfterHolder extends ChainHolder {
  /** Survivor shares received by trading in this merger so far. */
  received: number
  /** Still holds defunct shares to dispose of (may trade more). */
  undecided: boolean
}

/** The surviving chain once the merger ends: engine size, price, bonuses at that size. */
export interface SurvivorAfter {
  size: number
  price: number
  majority_bonus: number
  minority_bonus: number
  /** Survivor shares left in the bank now. */
  bank: number
  /** Most shares first; undecided players without survivor shares last (0 shares). */
  holders: SurvivorAfterHolder[]
}

export interface LobbyUpdateMessage {
  type: 'lobby_update'
  players: LobbySeat[]
  can_start: boolean
}

export interface ChooseChainMessage {
  type: 'choose_chain'
  available_chains: ChainId[]
}

export interface ChooseMergerSurvivorMessage {
  type: 'choose_merger_survivor'
  tied_chains: ChainId[]
}

/** Same-size defunct chains: the player who placed the tile picks which is absorbed next. */
export interface ChooseMergerOrderMessage {
  type: 'choose_merger_order'
  tied_chains: ChainId[]
  surviving_chain: ChainId
}

export interface StockDispositionMessage {
  type: 'stock_disposition_required'
  defunct_chain: ChainId
  surviving_chain: ChainId
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
  /** Transcript id (see /games/:gameId). */
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

/**
 * Trade messages are public: every player and the host receive each of them, with the offer's
 * terms. `seq` is the engine event's number (the same in `game_state.trade_log`).
 */
interface TradeMessageBase {
  seq?: number | null
  trade_id?: string
  /** The offer's proposer and recipient (null if the server no longer knows them). */
  from_player?: string | null
  to_player?: string | null
}

export interface TradeProposedMessage extends TradeMessageBase {
  type: 'trade_proposed'
  trade: TradeOffer
}

export interface TradeAcceptedMessage extends TradeMessageBase {
  type: 'trade_accepted'
  trade_id: string
  from_player: string
  to_player: string
  trade?: TradeOffer | null
}

export interface TradeRejectedMessage extends TradeMessageBase {
  type: 'trade_rejected'
  trade_id: string
  rejected_by: string
  trade?: TradeOffer | null
}

export interface TradeCanceledMessage extends TradeMessageBase {
  type: 'trade_canceled'
  trade_id: string
  canceled_by: string
  /** `cancelled` (withdrawn by the proposer) or `no_longer_valid`. */
  reason?: string
  trade?: TradeOffer | null
}

export type TradeLifecycleMessage =
  | TradeProposedMessage
  | TradeAcceptedMessage
  | TradeRejectedMessage
  | TradeCanceledMessage

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

// =============================================================================
// Table chat (docs/architecture/seat-contract.md, "Table chat")
// =============================================================================

/** One public table-chat message. `text` is plain text: render it as text, never as HTML. */
export interface ChatMessage {
  id: number
  player_id: string
  name: string
  kind: SeatKind
  /** `human`: typed by a player; `say`: posted by an AI with its move; `reply`: AI table talk. */
  source: 'human' | 'say' | 'reply'
  text: string
  /** ISO-8601 UTC. */
  at: string
  /** Seq of the last game event before the message (-1 in the lobby). */
  after_seq: number
  /** The message an AI reply answers, when it answers one. */
  reply_to: number | null
}

export interface ChatMessageMessage {
  type: 'chat_message'
  message: ChatMessage
}

/** Recent messages, sent on (re)connect when anything was said. */
export interface ChatHistoryMessage {
  type: 'chat_history'
  messages: ChatMessage[]
}

// =============================================================================
// Commentary (docs/ai/commentary.md; host / watch connection only)
// =============================================================================

/** One line of the commentator. `text` is plain text: render it as text, never as HTML. */
export interface CommentaryLine {
  id: number
  text: string
  /** `model`: written by the commentary model; `rules`: a templated line (no model call). */
  source: 'model' | 'rules'
  /** The turn the line is about. */
  turn: number
  /** Seq of the last game event the line knows about. */
  after_seq: number
  /** ISO-8601 UTC. */
  at: string
  /** What the line is about (`chain_founded`, `merger`, `majority`, `game_ended`, ...). */
  moments: string[]
}

/** Where the next line comes from: a model, or the rules-only templates. */
export type CommentaryMode = 'model' | 'rules'

export interface CommentaryMessage {
  type: 'commentary'
  line: CommentaryLine
  mode: CommentaryMode
}

/** The room's commentary setting and the lines so far: on (re)connect and when it changes. */
export interface CommentaryHistoryMessage {
  type: 'commentary_history'
  enabled: boolean
  mode: CommentaryMode
  lines: CommentaryLine[]
}

export type WebSocketMessage =
  | GameStateMessage
  | LobbyUpdateMessage
  | ChooseChainMessage
  | ChooseMergerSurvivorMessage
  | ChooseMergerOrderMessage
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
  | ChatMessageMessage
  | ChatHistoryMessage
  | CommentaryMessage
  | CommentaryHistoryMessage
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
  chain: ChainId
}

export interface MergerChoiceAction {
  action: 'merger_choice'
  surviving_chain: ChainId
}

export interface MergerOrderAction {
  action: 'merger_order'
  defunct_chain: ChainId
}

export interface MergerDispositionAction {
  action: 'merger_disposition'
  defunct_chain: ChainId
  disposition: {
    sell: number
    trade: number
    hold: number
  }
}

export interface BuyStocksAction {
  action: 'buy_stocks'
  purchases: Partial<Record<ChainId, number>>
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
  offering_stocks: Partial<Record<ChainId, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainId, number>>
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
  | MergerOrderAction
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

export interface AddSeatResponse {
  player_id: string
  name: string
  kind: SeatKind
}

// =============================================================================
// Trade Types
// =============================================================================

export interface TradeOffer {
  trade_id: string
  from_player_id: string
  to_player_id: string
  offering_stocks: Partial<Record<ChainId, number>>
  offering_money: number
  requesting_stocks: Partial<Record<ChainId, number>>
  requesting_money: number
  // Note: status is tracked client-side based on WebSocket messages
  // Backend doesn't send a status field in the trade object
}
