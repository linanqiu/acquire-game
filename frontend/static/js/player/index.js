/**
 * ACQUIRE Board Game - Player View Entry Point
 * Manages WebSocket connection and player interactions for mobile devices
 */

import { MESSAGE_TYPES, ACTION_TYPES, PHASES, CONFIG, CHAIN_NAMES } from '../shared/constants.js';
import { formatMoney } from '../shared/formatters.js';
import { createSocket, buildPlayerUrl } from '../shared/websocket.js';
import { createPlayerState, createMergerState } from '../shared/state.js';
import { updateTileRack, clearTileSelection, selectTile, enableTiles, createTileConfirmHtml } from './tiles.js';
import { updateMoney, updateStockPortfolio, getChainPrice, getAvailableStocks } from './portfolio.js';
import { updateTurnIndicator, updateConnectionStatus, showLobbyWaiting, showPlaceTileMessage, createEndGameOptionHtml, showError } from './actions.js';
import {
    showFoundChainUI, showChooseSurvivorUI, showBuyStocksUI,
    resetBuyStocks, getTotalSelectedStocks, getPurchases, updateBuyTotal,
    showMergerDispositionUI, adjustMergerQuantity, updateMergerDisplay,
    validateMergerDisposition, getMergerDisposition, hideAllActionPanels
} from './modals.js';

// Create state stores
const store = createPlayerState();
const mergerStore = createMergerState();

// Player credentials
let roomCode = null;
let playerId = null;
let playerName = null;

// DOM element references
let elements = {};

// WebSocket connection
let socket = null;

// Local UI state
let selectedTile = null;
let currentPhase = null;
let isMyTurn = false;

/**
 * Initialize the player view
 */
function init() {
    // Get credentials from page
    const credentials = getCredentials();
    roomCode = credentials.roomCode;
    playerId = credentials.playerId;
    playerName = credentials.playerName;

    if (!roomCode || !playerId) {
        console.error('Missing room code or player ID');
        showError('Session not found. Please rejoin the game.');
        return;
    }

    // Cache DOM elements
    cacheElements();

    // Set up event listeners
    setupEventListeners();

    // Set up WebSocket connection
    setupWebSocket();

    // Window event handlers
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('online', () => socket?.connect());
    window.addEventListener('offline', () => {
        store.setState({ connectionStatus: 'disconnected' });
        updateConnectionStatus(elements.gameStatus, 'disconnected');
    });

    // Prevent pull-to-refresh on mobile
    document.body.addEventListener('touchmove', preventOverscroll, { passive: false });
}

/**
 * Get credentials from page
 */
function getCredentials() {
    // Try window.PLAYER_DATA first (set by Jinja2 template)
    if (window.PLAYER_DATA) {
        return {
            roomCode: window.PLAYER_DATA.roomCode,
            playerId: window.PLAYER_DATA.playerId,
            playerName: window.PLAYER_DATA.playerName
        };
    }

    // Try data attributes
    const container = document.querySelector('[data-room-code]');
    if (container) {
        return {
            roomCode: container.dataset.roomCode,
            playerId: container.dataset.playerId,
            playerName: container.dataset.playerName
        };
    }

    // Try URL path (e.g., /play/ABCD?player_id=xyz)
    const pathMatch = window.location.pathname.match(/\/play\/([A-Z0-9]+)/i);
    const urlParams = new URLSearchParams(window.location.search);
    if (pathMatch) {
        return {
            roomCode: pathMatch[1].toUpperCase(),
            playerId: urlParams.get('player_id'),
            playerName: urlParams.get('name')
        };
    }

    return {
        roomCode: urlParams.get('room'),
        playerId: urlParams.get('player_id'),
        playerName: urlParams.get('name')
    };
}

/**
 * Cache DOM element references
 */
function cacheElements() {
    elements = {
        playerName: document.getElementById('player-name'),
        playerMoney: document.getElementById('player-money'),
        tileRack: document.getElementById('tile-rack'),
        portfolioTable: document.getElementById('portfolio-table'),
        actionSection: document.getElementById('action-section'),
        actionButtons: document.getElementById('action-buttons'),
        waitingMessage: document.getElementById('waiting-message'),
        buyStocksSection: document.getElementById('buy-stocks-section'),
        mergerSection: document.getElementById('merger-section'),
        chooseChainSection: document.getElementById('choose-chain-section'),
        gameStatus: document.getElementById('game-status')
    };
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Tile rack click handlers
    if (elements.tileRack) {
        elements.tileRack.addEventListener('click', handleTileRackClick);
    }

    // Buy stocks section
    setupBuyStocksListeners();

    // Merger section
    setupMergerListeners();
}

/**
 * Set up buy stocks event listeners
 */
function setupBuyStocksListeners() {
    // Quantity buttons
    document.querySelectorAll('.qty-btn').forEach(btn => {
        btn.addEventListener('click', handleQuantityChange);
    });

    // Cancel buy
    const cancelBuy = document.getElementById('cancel-buy');
    if (cancelBuy) {
        cancelBuy.addEventListener('click', () => {
            resetBuyStocks();
            sendAction(ACTION_TYPES.BUY_STOCKS, { purchases: {} });
        });
    }

    // Confirm buy
    const confirmBuy = document.getElementById('confirm-buy');
    if (confirmBuy) {
        confirmBuy.addEventListener('click', handleConfirmBuy);
    }
}

/**
 * Set up merger event listeners
 */
function setupMergerListeners() {
    const sellMinus = document.getElementById('sell-minus');
    const sellPlus = document.getElementById('sell-plus');
    const tradeMinus = document.getElementById('trade-minus');
    const tradePlus = document.getElementById('trade-plus');
    const confirmMerger = document.getElementById('confirm-merger');

    if (sellMinus) sellMinus.addEventListener('click', () => {
        adjustMergerQuantity(mergerStore.getState(), 'sell', -1);
        mergerStore.setState(mergerStore.getState());
    });
    if (sellPlus) sellPlus.addEventListener('click', () => {
        adjustMergerQuantity(mergerStore.getState(), 'sell', 1);
        mergerStore.setState(mergerStore.getState());
    });
    if (tradeMinus) tradeMinus.addEventListener('click', () => {
        adjustMergerQuantity(mergerStore.getState(), 'trade', -2);
        mergerStore.setState(mergerStore.getState());
    });
    if (tradePlus) tradePlus.addEventListener('click', () => {
        adjustMergerQuantity(mergerStore.getState(), 'trade', 2);
        mergerStore.setState(mergerStore.getState());
    });
    if (confirmMerger) confirmMerger.addEventListener('click', handleConfirmMerger);
}

/**
 * Prevent overscroll/pull-to-refresh
 */
function preventOverscroll(e) {
    if (e.target.closest('.log-container, .portfolio-table')) {
        return; // Allow scrolling in these containers
    }
    if (document.body.scrollTop === 0) {
        e.preventDefault();
    }
}

/**
 * Set up WebSocket connection
 */
function setupWebSocket() {
    const url = buildPlayerUrl(roomCode, playerId);

    socket = createSocket({
        url,
        handlers: {
            [MESSAGE_TYPES.GAME_STATE]: handleGameState,
            [MESSAGE_TYPES.LOBBY_UPDATE]: handleLobbyUpdate,
            [MESSAGE_TYPES.CHOOSE_CHAIN]: (msg) => showFoundChainUI(
                elements.chooseChainSection,
                msg.available_chains,
                foundChain
            ),
            [MESSAGE_TYPES.CHOOSE_MERGER_SURVIVOR]: (msg) => showChooseSurvivorUI(
                elements.chooseChainSection,
                msg.tied_chains,
                chooseSurvivor
            ),
            [MESSAGE_TYPES.MERGER_DISPOSITION]: (msg) => showMergerDispositionUI(
                elements.mergerSection,
                elements.waitingMessage,
                msg,
                mergerStore.getState()
            ),
            [MESSAGE_TYPES.CAN_END_GAME]: (msg) => showEndGameOption(msg.message),
            [MESSAGE_TYPES.GAME_OVER]: handleGameOver,
            [MESSAGE_TYPES.ERROR]: (msg) => showError(msg.message),
            [MESSAGE_TYPES.PONG]: () => {} // Heartbeat response
        },
        onConnect: () => {
            store.setState({ connectionStatus: 'connected' });
            updateConnectionStatus(elements.gameStatus, 'connected');
        },
        onDisconnect: () => {
            store.setState({ connectionStatus: 'disconnected' });
            updateConnectionStatus(elements.gameStatus, 'disconnected');
        },
        onError: (error) => {
            if (error.message === 'Max reconnection attempts reached') {
                showError('Connection lost. Please refresh the page to rejoin.');
            }
        }
    });

    socket.connect();
}

/**
 * Handle game state message
 */
function handleGameState(data) {
    console.log('handleGameState called with:', {
        type: data.type,
        current_player: data.current_player,
        phase: data.phase,
        your_hand: data.your_hand,
        playerId: playerId
    });

    // Update local game state
    store.setState({
        board: data.board,
        chains: data.hotel || {},
        players: data.players || {},
        phase: data.phase,
        currentPlayer: data.current_player
    });

    const state = store.getState();

    // Update player's hand from your_hand
    if (data.your_hand) {
        console.log('Updating tiles with your_hand:', data.your_hand);
        store.setState({ tiles: data.your_hand });
        updateTileRack(elements.tileRack, data.your_hand, isMyTurn, currentPhase);
    } else {
        console.warn('No your_hand in game state message!');
    }

    // Update money from players data
    if (data.players && data.players[playerId]) {
        const myData = data.players[playerId];
        store.setState({
            money: myData.money,
            stocks: myData.stocks || {}
        });
        updateMoney(elements.playerMoney, myData.money);
        updateStockPortfolio(myData.stocks || {}, state.chains);
    }

    // Determine if it's my turn
    isMyTurn = data.current_player === playerId;
    currentPhase = data.phase;
    store.setState({ isMyTurn, phase: currentPhase });

    updateTurnIndicator(elements.waitingMessage, isMyTurn, data.phase);

    // Update tile rack with new turn state
    updateTileRack(elements.tileRack, store.get('tiles') || [], isMyTurn, currentPhase);

    // Update UI based on phase
    updatePhaseUI(data.phase, isMyTurn);
}

/**
 * Handle lobby update
 */
function handleLobbyUpdate(data) {
    showLobbyWaiting(elements.waitingMessage, data.players.length);
}

/**
 * Handle game over message
 */
function handleGameOver(data) {
    isMyTurn = false;
    hideAllActionPanels({
        buyStocksSection: elements.buyStocksSection,
        mergerSection: elements.mergerSection,
        chooseChainSection: elements.chooseChainSection
    });

    // Show game over UI
    const scores = data.scores || {};
    const winnerId = data.winner;

    let html = '<div class="game-over-panel">';
    html += '<h2>Game Over!</h2>';

    // Sort players by score
    const sortedPlayers = Object.entries(scores)
        .sort((a, b) => b[1].money - a[1].money);

    html += '<div class="final-standings">';
    sortedPlayers.forEach(([pid, info], index) => {
        const isMe = pid === playerId;
        const isWinner = pid === winnerId;
        html += `
            <div class="standing-row ${isMe ? 'is-me' : ''} ${isWinner ? 'is-winner' : ''}">
                <span class="rank">${index + 1}.</span>
                <span class="name">${info.name} ${isMe ? '(You)' : ''} ${isWinner ? '- Winner!' : ''}</span>
                <span class="score">${formatMoney(info.money)}</span>
            </div>
        `;
    });
    html += '</div></div>';

    if (elements.actionButtons) {
        elements.actionButtons.innerHTML = html;
    }
}

/**
 * Update UI based on game phase
 */
function updatePhaseUI(phase, myTurn) {
    currentPhase = phase;
    hideAllActionPanels({
        buyStocksSection: elements.buyStocksSection,
        mergerSection: elements.mergerSection,
        chooseChainSection: elements.chooseChainSection
    });

    if (!myTurn) {
        if (elements.waitingMessage) {
            elements.waitingMessage.style.display = 'block';
        }
        return;
    }

    switch (phase) {
        case PHASES.PLACE_TILE:
            showPlaceTileUI();
            break;
        case PHASES.BUY_STOCKS:
            showBuyStocksUI(
                elements.buyStocksSection,
                elements.waitingMessage,
                store.get('chains'),
                store.get('money')
            );
            break;
        case PHASES.MERGER:
            // Merger UI is triggered by specific messages
            break;
        case PHASES.FOUND_CHAIN:
            // Found chain UI is triggered by choose_chain message
            break;
    }
}

/**
 * Show place tile UI
 */
function showPlaceTileUI() {
    showPlaceTileMessage(elements.waitingMessage);
    enableTiles(elements.tileRack);
}

/**
 * Handle click on tile rack
 */
function handleTileRackClick(e) {
    const tile = e.target.closest('.tile');
    if (!tile || tile.disabled) return;

    const tileStr = tile.dataset.tile;
    if (!tileStr) return;

    // Don't allow selection if not my turn or not in place_tile phase
    if (!isMyTurn || currentPhase !== PHASES.PLACE_TILE) {
        showError('Not your turn to place a tile');
        return;
    }

    // Toggle selection
    if (selectedTile === tileStr) {
        // Already selected, deselect
        selectedTile = null;
        clearTileSelection(elements.tileRack);
        hideConfirmTile();
    } else {
        // Select this tile
        clearTileSelection(elements.tileRack);
        selectedTile = tileStr;
        selectTile(tile);
        showConfirmTile(tileStr);
    }
}

/**
 * Show tile placement confirmation
 */
function showConfirmTile(tileStr) {
    if (!elements.actionButtons) return;

    elements.actionButtons.innerHTML = createTileConfirmHtml(tileStr);

    document.getElementById('confirm-place-tile').addEventListener('click', () => {
        if (placeTile(tileStr)) {
            selectedTile = null;
            clearTileSelection(elements.tileRack);
            hideConfirmTile();
        }
    });

    document.getElementById('cancel-place-tile').addEventListener('click', () => {
        selectedTile = null;
        clearTileSelection(elements.tileRack);
        hideConfirmTile();
    });
}

/**
 * Hide tile confirmation
 */
function hideConfirmTile() {
    if (elements.waitingMessage) {
        elements.waitingMessage.style.display = 'block';
    }
    if (elements.actionButtons) {
        elements.actionButtons.innerHTML = '';
    }
}

/**
 * Handle quantity change button click
 */
function handleQuantityChange(e) {
    const btn = e.target;
    const chain = btn.dataset.chain;
    if (!chain) return;

    const qtyEl = document.getElementById(`qty-${chain}`);
    if (!qtyEl) return;

    let qty = parseInt(qtyEl.textContent) || 0;
    const isPlus = btn.classList.contains('qty-plus');

    // Get total current selections
    const totalSelected = getTotalSelectedStocks();

    // Get available stocks for this chain
    const available = getAvailableStocks(chain, store.get('chains'));

    if (isPlus) {
        if (totalSelected < CONFIG.maxStocksPerTurn && qty < available) {
            qty++;
        }
    } else {
        if (qty > 0) {
            qty--;
        }
    }

    qtyEl.textContent = qty;
    updateBuyTotal(store.get('chains'), store.get('money'));
}

/**
 * Handle confirm buy stocks
 */
function handleConfirmBuy() {
    const purchases = getPurchases();
    if (buyStocks(purchases)) {
        elements.buyStocksSection.classList.add('hidden');
    }
}

/**
 * Handle confirm merger
 */
function handleConfirmMerger() {
    const state = mergerStore.getState();
    const validation = validateMergerDisposition(state);

    if (!validation.valid) {
        showError(validation.error);
        return;
    }

    const disposition = getMergerDisposition(state);
    if (mergerDisposition(state.defunctChain, disposition)) {
        elements.mergerSection.classList.add('hidden');
    }
}

/**
 * Show end game option
 */
function showEndGameOption(message) {
    if (!elements.actionButtons) return;

    elements.actionButtons.innerHTML = createEndGameOptionHtml(message);

    document.getElementById('end-game-btn').addEventListener('click', () => {
        sendAction(ACTION_TYPES.END_GAME, {});
    });

    document.getElementById('continue-game-btn').addEventListener('click', () => {
        elements.actionButtons.innerHTML = '';
    });
}

// Action senders
function sendAction(action, data = {}) {
    if (!socket?.isConnected()) {
        showError('Not connected. Please wait...');
        return false;
    }
    return socket.send(action, data);
}

function placeTile(tileStr) {
    return sendAction(ACTION_TYPES.PLACE_TILE, { tile: tileStr });
}

function foundChain(chainName) {
    return sendAction(ACTION_TYPES.FOUND_CHAIN, { chain: chainName });
}

function buyStocks(purchases) {
    return sendAction(ACTION_TYPES.BUY_STOCKS, { purchases });
}

function mergerDisposition(defunctChain, disposition) {
    return sendAction(ACTION_TYPES.MERGER_DISPOSITION, {
        defunct_chain: defunctChain,
        disposition
    });
}

function chooseSurvivor(chainName) {
    return sendAction(ACTION_TYPES.MERGER_CHOICE, { surviving_chain: chainName });
}

function endTurn() {
    return sendAction(ACTION_TYPES.END_TURN, {});
}

/**
 * Clean up on page unload
 */
function cleanup() {
    socket?.close();
}

// Public API
window.AcquirePlayer = {
    init,
    sendAction,
    placeTile,
    foundChain,
    buyStocks,
    mergerDisposition,
    chooseSurvivor,
    endTurn,
    getGameState: () => store.getState()
};

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

export { init, sendAction, placeTile, foundChain, buyStocks, mergerDisposition, chooseSurvivor, endTurn };
