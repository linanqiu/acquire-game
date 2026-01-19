/**
 * Shared constants for the Acquire game
 * Single source of truth for chain definitions, colors, and configuration
 */

// Hotel chain names in order (cheap to expensive tiers)
export const CHAIN_NAMES = [
    'luxor',
    'tower',
    'american',
    'festival',
    'worldwide',
    'continental',
    'imperial'
];

// Chain tiers for pricing
export const CHAIN_TIERS = {
    cheap: ['luxor', 'tower'],
    medium: ['american', 'festival', 'worldwide'],
    expensive: ['continental', 'imperial']
};

// Chain colors for UI display
// These match the CSS variables in style.css
export const CHAIN_COLORS = {
    luxor: '#FFD700',      // Gold
    tower: '#FF6B6B',      // Red
    american: '#4ECDC4',   // Teal
    worldwide: '#9B59B6',  // Purple
    festival: '#2ECC71',   // Green
    imperial: '#E67E22',   // Orange
    continental: '#3498DB' // Blue
};

// Short names for compact display
export const CHAIN_SHORT_NAMES = {
    luxor: 'LUX',
    tower: 'TOW',
    american: 'AME',
    festival: 'FES',
    worldwide: 'WOR',
    continental: 'CON',
    imperial: 'IMP'
};

// Game configuration
export const CONFIG = {
    reconnectDelay: 3000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    maxLogEntries: 50,
    maxStocksPerTurn: 3,
    startingMoney: 6000,
    stocksPerChain: 25,
    safeChainSize: 11,
    maxPlayers: 6,
    minPlayers: 2,
    tilesPerPlayer: 6
};

// Board dimensions
export const BOARD = {
    columns: 12,
    rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    minColumn: 1,
    maxColumn: 12
};

// Game phases
export const PHASES = {
    PLACE_TILE: 'place_tile',
    FOUND_CHAIN: 'found_chain',
    BUY_STOCKS: 'buy_stocks',
    MERGER: 'merger'
};

// Phase descriptions for UI
export const PHASE_DESCRIPTIONS = {
    place_tile: 'Place Tile',
    found_chain: 'Found Chain',
    buy_stocks: 'Buy Stocks',
    merger: 'Merger'
};

// WebSocket message types
export const MESSAGE_TYPES = {
    GAME_STATE: 'game_state',
    LOBBY_UPDATE: 'lobby_update',
    GAME_OVER: 'game_over',
    CHOOSE_CHAIN: 'choose_chain',
    CHOOSE_MERGER_SURVIVOR: 'choose_merger_survivor',
    MERGER_DISPOSITION: 'merger_disposition',
    CAN_END_GAME: 'can_end_game',
    ERROR: 'error',
    PONG: 'pong'
};

// WebSocket action types
export const ACTION_TYPES = {
    PLACE_TILE: 'place_tile',
    FOUND_CHAIN: 'found_chain',
    BUY_STOCKS: 'buy_stocks',
    MERGER_DISPOSITION: 'merger_disposition',
    MERGER_CHOICE: 'merger_choice',
    END_TURN: 'end_turn',
    ADD_BOT: 'add_bot',
    START_GAME: 'start_game',
    END_GAME: 'end_game'
};
