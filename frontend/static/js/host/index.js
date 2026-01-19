/**
 * ACQUIRE Board Game - Host View Entry Point
 * Manages WebSocket connection and display updates for the TV/host screen
 */

import { MESSAGE_TYPES, ACTION_TYPES, PHASE_DESCRIPTIONS } from '../shared/constants.js';
import { formatMoney } from '../shared/formatters.js';
import { createSocket, buildHostUrl } from '../shared/websocket.js';
import { createHostState } from '../shared/state.js';
import { updateBoard, updateChainInfo } from './board.js';
import { updateScoreboard, updateLobbyScoreboard, updateCurrentPlayer, showWinner } from './scoreboard.js';
import { updateLobbyControls, hideLobbyControls, updateWaitingMessage } from './controls.js';
import { addLogEntry, logTurnChange, logPhaseChange, logGameOver } from './log.js';

// Create state store
const store = createHostState();

// DOM element references
let elements = {};

// WebSocket connection
let socket = null;

/**
 * Initialize the host view
 */
function init() {
    // Get room code from page
    const roomCode = getRoomCode();

    if (!roomCode) {
        console.error('No room code found');
        showError('Room code not found. Please check the URL.');
        return;
    }

    // Cache DOM elements
    cacheElements();

    // Set up WebSocket connection
    setupWebSocket(roomCode);

    // Set up window event handlers
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('online', () => socket?.connect());
    window.addEventListener('offline', () => {
        store.setState({ connectionStatus: 'disconnected' });
    });
}

/**
 * Get room code from the page
 */
function getRoomCode() {
    // Try window.HOST_DATA first (set by Jinja2 template)
    if (window.HOST_DATA?.roomCode) {
        return window.HOST_DATA.roomCode;
    }

    // Try data attribute
    const container = document.querySelector('[data-room-code]');
    if (container) {
        return container.dataset.roomCode;
    }

    // Try URL path (e.g., /host/ABCD)
    const pathMatch = window.location.pathname.match(/\/host\/([A-Z0-9]+)/i);
    if (pathMatch) {
        return pathMatch[1].toUpperCase();
    }

    // Try room-code element content
    const roomCodeEl = document.getElementById('room-code');
    if (roomCodeEl) {
        return roomCodeEl.textContent.trim();
    }

    // Try URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('room');
}

/**
 * Cache DOM element references
 */
function cacheElements() {
    elements = {
        roomCode: document.getElementById('room-code'),
        currentPlayer: document.getElementById('current-player'),
        gameBoard: document.getElementById('game-board'),
        playerScoresBody: document.getElementById('player-scores-body'),
        gameLog: document.getElementById('game-log'),
        lobbyControls: document.getElementById('lobby-controls'),
        startGameBtn: document.getElementById('start-game-btn'),
        addBotBtn: document.getElementById('add-bot-btn'),
        playerCount: document.getElementById('player-count')
    };
}

/**
 * Set up WebSocket connection
 */
function setupWebSocket(roomCode) {
    const url = buildHostUrl(roomCode);

    socket = createSocket({
        url,
        handlers: {
            [MESSAGE_TYPES.GAME_STATE]: handleGameState,
            [MESSAGE_TYPES.LOBBY_UPDATE]: handleLobbyUpdate,
            [MESSAGE_TYPES.GAME_OVER]: handleGameOver,
            [MESSAGE_TYPES.PONG]: () => {} // Heartbeat response
        },
        onConnect: () => {
            store.setState({ connectionStatus: 'connected' });
            addLogEntry(elements.gameLog, 'Connected to game server');
        },
        onDisconnect: () => {
            store.setState({ connectionStatus: 'disconnected' });
        },
        onError: (error) => {
            addLogEntry(elements.gameLog, 'Connection error', 'error');
            if (error.message === 'Max reconnection attempts reached') {
                showError('Connection lost. Please refresh the page.');
            }
        }
    });

    socket.connect();
}

/**
 * Handle game state message
 */
function handleGameState(data) {
    const prevState = store.getState();

    // Update state
    store.setState({
        board: data.board,
        hotel: data.hotel,
        players: data.players || {},
        currentPlayer: data.current_player,
        phase: data.phase,
        tilesRemaining: data.tiles_remaining || 0,
        turnOrder: data.turn_order || [],
        isGameStarted: true
    });

    const state = store.getState();

    // Hide lobby controls when game has started
    hideLobbyControls(elements.lobbyControls);

    // Update all UI components
    updateBoard(data.board);
    updateChainInfo(data.hotel);
    updateScoreboard(
        elements.playerScoresBody,
        state.players,
        state.currentPlayer,
        state.turnOrder
    );
    updateCurrentPlayer(
        elements.currentPlayer,
        state.players,
        state.currentPlayer,
        state.phase,
        PHASE_DESCRIPTIONS
    );

    // Log turn changes
    if (prevState.currentPlayer !== state.currentPlayer && state.currentPlayer) {
        const playerName = state.players[state.currentPlayer]?.name || 'Unknown';
        logTurnChange(elements.gameLog, playerName, PHASE_DESCRIPTIONS[state.phase] || state.phase);
    } else if (prevState.phase !== state.phase) {
        logPhaseChange(elements.gameLog, PHASE_DESCRIPTIONS[state.phase] || state.phase);
    }
}

/**
 * Handle lobby update message
 */
function handleLobbyUpdate(data) {
    const players = data.players || [];

    // Update scoreboard with lobby players
    updateLobbyScoreboard(elements.playerScoresBody, players);

    // Update lobby controls
    updateLobbyControls(
        {
            lobbyControls: elements.lobbyControls,
            startGameBtn: elements.startGameBtn,
            addBotBtn: elements.addBotBtn,
            playerCount: elements.playerCount
        },
        players,
        data.can_start
    );

    // Update waiting message
    updateWaitingMessage(elements.currentPlayer, players.length);

    if (data.can_start) {
        addLogEntry(elements.gameLog, `${players.length} players joined - Ready to start!`, 'info');
    }
}

/**
 * Handle game over message
 */
function handleGameOver(data) {
    const scores = data.scores || {};
    const winnerId = data.winner;

    // Log final standings
    logGameOver(elements.gameLog, scores, winnerId, formatMoney);

    // Update current player display
    if (winnerId && scores[winnerId]) {
        showWinner(elements.currentPlayer, scores[winnerId].name);
    }
}

/**
 * Send action to server
 */
function sendAction(action, data = {}) {
    if (!socket?.isConnected()) {
        showError('Not connected');
        return false;
    }
    return socket.send(action, data);
}

/**
 * Add bot to the game
 */
function addBot() {
    sendAction(ACTION_TYPES.ADD_BOT);
    addLogEntry(elements.gameLog, 'Adding bot...');
}

/**
 * Start the game
 */
function startGame() {
    sendAction(ACTION_TYPES.START_GAME);
    addLogEntry(elements.gameLog, 'Starting game...');
}

/**
 * End the game (host override)
 */
function endGame() {
    if (confirm('Are you sure you want to end the game?')) {
        sendAction(ACTION_TYPES.END_GAME);
        addLogEntry(elements.gameLog, 'Ending game...');
    }
}

/**
 * Show error message
 */
function showError(message) {
    addLogEntry(elements.gameLog, `ERROR: ${message}`, 'error');
    console.error(message);
}

/**
 * Clean up on page unload
 */
function cleanup() {
    socket?.close();
}

// Public API
window.AcquireHost = {
    init,
    addBot,
    startGame,
    endGame,
    sendAction,
    addLogEntry: (msg, type) => addLogEntry(elements.gameLog, msg, type),
    getGameState: () => store.getState()
};

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export { init, addBot, startGame, endGame, sendAction };
