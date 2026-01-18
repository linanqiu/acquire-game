/**
 * ACQUIRE Board Game - Host View JavaScript
 * Manages WebSocket connection and display updates for the TV/host screen
 */

(function() {
    'use strict';

    // ==========================================================================
    // CONFIGURATION
    // ==========================================================================

    const CONFIG = {
        reconnectDelay: 3000,
        maxReconnectAttempts: 10,
        heartbeatInterval: 30000,
        maxLogEntries: 50
    };

    // Chain colors for styling
    const CHAIN_COLORS = {
        luxor: '#FFD700',      // Gold
        tower: '#FF6B6B',      // Red
        american: '#4ECDC4',   // Teal
        worldwide: '#9B59B6',  // Purple
        festival: '#2ECC71',   // Green
        imperial: '#E67E22',   // Orange
        continental: '#3498DB' // Blue
    };

    // ==========================================================================
    // STATE
    // ==========================================================================

    let ws = null;
    let roomCode = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;
    let gameState = {
        board: null,
        hotel: null,
        players: {},
        currentPlayer: null,
        phase: null,
        tilesRemaining: 0
    };

    // ==========================================================================
    // DOM ELEMENTS
    // ==========================================================================

    const elements = {};

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    /**
     * Initialize the host view
     */
    function init() {
        // Get room code from page
        roomCode = getRoomCode();

        if (!roomCode) {
            console.error('No room code found');
            showError('Room code not found. Please check the URL.');
            return;
        }

        // Cache DOM elements
        cacheElements();

        // Initialize the board grid
        initializeBoard();

        // Connect to WebSocket
        connect();

        // Set up window event handlers
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
    }

    /**
     * Get room code from the page (data attribute or URL)
     */
    function getRoomCode() {
        // Try data attribute first
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
        elements.roomCode = document.getElementById('room-code');
        elements.currentPlayer = document.getElementById('current-player');
        elements.gameBoard = document.getElementById('game-board');
        elements.playerScoresBody = document.getElementById('player-scores-body');
        elements.gameLog = document.getElementById('game-log');

        // Chain size elements
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        elements.chainSizes = {};
        chains.forEach(chain => {
            elements.chainSizes[chain] = document.getElementById(`size-${chain}`);
        });
    }

    /**
     * Initialize the game board with cell references
     */
    function initializeBoard() {
        // The board is already in HTML, but we can add any initialization here
        // Board is 12 columns (1-12) x 9 rows (A-I)
    }

    // ==========================================================================
    // WEBSOCKET CONNECTION
    // ==========================================================================

    /**
     * Connect to WebSocket server
     */
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            return;
        }

        updateConnectionStatus('connecting');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/host/${roomCode}`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = handleOpen;
            ws.onclose = handleClose;
            ws.onerror = handleError;
            ws.onmessage = handleMessage;
        } catch (error) {
            console.error('WebSocket connection error:', error);
            updateConnectionStatus('disconnected');
            scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket open event
     */
    function handleOpen() {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
        reconnectAttempts = 0;
        startHeartbeat();
        addLogEntry('Connected to game server');
    }

    /**
     * Handle WebSocket close event
     */
    function handleClose(event) {
        console.log('WebSocket closed:', event.code, event.reason);
        updateConnectionStatus('disconnected');
        stopHeartbeat();

        if (event.code !== 1000) {
            scheduleReconnect();
        }
    }

    /**
     * Handle WebSocket error event
     */
    function handleError(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
        addLogEntry('Connection error', 'error');
    }

    /**
     * Handle incoming WebSocket message
     */
    function handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('Received message:', message);
            processMessage(message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    /**
     * Process received message based on type
     */
    function processMessage(message) {
        const { type } = message;

        switch (type) {
            case 'game_state':
                handleGameState(message);
                break;
            case 'lobby_update':
                handleLobbyUpdate(message);
                break;
            case 'game_over':
                handleGameOver(message);
                break;
            case 'pong':
                // Heartbeat response
                break;
            default:
                console.log('Unknown message type:', type);
        }
    }

    /**
     * Schedule reconnection attempt
     */
    function scheduleReconnect() {
        if (reconnectAttempts >= CONFIG.maxReconnectAttempts) {
            showError('Connection lost. Please refresh the page.');
            return;
        }

        reconnectAttempts++;
        const delay = CONFIG.reconnectDelay * Math.min(reconnectAttempts, 5);

        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        addLogEntry(`Reconnecting... (attempt ${reconnectAttempts})`);
        setTimeout(connect, delay);
    }

    /**
     * Start heartbeat to keep connection alive
     */
    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, CONFIG.heartbeatInterval);
    }

    /**
     * Stop heartbeat timer
     */
    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    /**
     * Clean up on page unload
     */
    function cleanup() {
        stopHeartbeat();
        if (ws) {
            ws.close(1000, 'Page unload');
        }
    }

    /**
     * Handle browser coming online
     */
    function handleOnline() {
        console.log('Browser online, reconnecting...');
        connect();
    }

    /**
     * Handle browser going offline
     */
    function handleOffline() {
        console.log('Browser offline');
        updateConnectionStatus('disconnected');
    }

    /**
     * Send action to server (for host controls)
     */
    function sendAction(action, data = {}) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showError('Not connected');
            return false;
        }

        const message = { action, ...data };
        ws.send(JSON.stringify(message));
        return true;
    }

    // ==========================================================================
    // MESSAGE HANDLERS
    // ==========================================================================

    /**
     * Handle full game state update
     */
    function handleGameState(data) {
        // Store previous state for comparison
        const previousPlayer = gameState.currentPlayer;
        const previousPhase = gameState.phase;

        // Update local game state
        gameState.board = data.board;
        gameState.hotel = data.hotel;
        gameState.players = data.players || {};
        gameState.currentPlayer = data.current_player;
        gameState.phase = data.phase;
        gameState.tilesRemaining = data.tiles_remaining || 0;
        gameState.turnOrder = data.turn_order || [];

        // Update all UI components
        updateBoard(data.board);
        updateChainInfo(data.hotel);
        updateScoreboard(data.players, data.current_player, data.turn_order);
        updateCurrentPlayer(data.current_player, data.phase);

        // Log turn changes
        if (previousPlayer !== data.current_player && data.current_player) {
            const playerName = gameState.players[data.current_player]?.name || 'Unknown';
            addLogEntry(`${playerName}'s turn - ${getPhaseDescription(data.phase)}`, 'turn');
        } else if (previousPhase !== data.phase) {
            addLogEntry(`Phase: ${getPhaseDescription(data.phase)}`);
        }
    }

    /**
     * Handle lobby update (pre-game)
     */
    function handleLobbyUpdate(data) {
        const players = data.players || [];

        // Update scoreboard with lobby players
        if (elements.playerScoresBody) {
            elements.playerScoresBody.innerHTML = '';

            players.forEach(player => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${escapeHtml(player.name)}${player.is_bot ? ' (Bot)' : ''}</td>
                    <td>$6,000</td>
                    <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
                `;
                elements.playerScoresBody.appendChild(row);
            });
        }

        if (elements.currentPlayer) {
            elements.currentPlayer.textContent = `Waiting for players... (${players.length} joined)`;
        }

        if (data.can_start) {
            addLogEntry(`${players.length} players joined - Ready to start!`, 'info');
        }
    }

    /**
     * Handle game over
     */
    function handleGameOver(data) {
        const scores = data.scores || {};
        const winnerId = data.winner;

        // Sort players by score
        const sortedPlayers = Object.entries(scores)
            .sort((a, b) => b[1].money - a[1].money);

        // Log final standings
        addLogEntry('=== GAME OVER ===', 'important');

        sortedPlayers.forEach(([pid, info], index) => {
            const isWinner = pid === winnerId;
            addLogEntry(
                `${index + 1}. ${info.name}: ${formatMoney(info.money)}${isWinner ? ' - WINNER!' : ''}`,
                isWinner ? 'winner' : 'info'
            );
        });

        // Update current player display
        if (elements.currentPlayer && winnerId && scores[winnerId]) {
            elements.currentPlayer.textContent = `Winner: ${scores[winnerId].name}!`;
            elements.currentPlayer.classList.add('winner');
        }
    }

    // ==========================================================================
    // UI UPDATE FUNCTIONS
    // ==========================================================================

    /**
     * Update connection status indicator
     */
    function updateConnectionStatus(status) {
        // Could add visual indicator if desired
        console.log('Connection status:', status);
    }

    /**
     * Update the game board display
     */
    function updateBoard(boardData) {
        if (!boardData || !boardData.cells) return;

        const cells = boardData.cells;

        // cells is an array of cell objects with row, col, played, chain properties
        cells.forEach(cell => {
            const col = cell.col + 1; // Convert 0-indexed to 1-indexed
            const row = String.fromCharCode(65 + cell.row); // Convert 0-indexed to A-I
            const cellId = `cell-${col}-${row}`;
            const cellElement = document.getElementById(cellId);

            if (cellElement) {
                // Remove all previous state classes
                cellElement.classList.remove('played', 'luxor', 'tower', 'american',
                    'worldwide', 'festival', 'imperial', 'continental');

                if (cell.chain) {
                    // Cell belongs to a chain
                    cellElement.classList.add(cell.chain.toLowerCase());
                    cellElement.style.backgroundColor = CHAIN_COLORS[cell.chain.toLowerCase()] || '#666';
                    cellElement.style.color = '#000';
                } else if (cell.played) {
                    // Cell has a tile but no chain yet
                    cellElement.classList.add('played');
                    cellElement.style.backgroundColor = '#888';
                    cellElement.style.color = '#fff';
                } else {
                    // Empty cell
                    cellElement.style.backgroundColor = '';
                    cellElement.style.color = '';
                }
            }
        });
    }

    /**
     * Update chain information display
     */
    function updateChainInfo(hotelData) {
        if (!hotelData) return;

        const chains = hotelData.chains || [];
        const activeChains = hotelData.active_chains || [];

        // Update chain sizes and status
        const allChains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];

        allChains.forEach(chainName => {
            const sizeEl = elements.chainSizes[chainName];
            const chainItem = document.querySelector(`.chain-item[data-chain="${chainName}"]`);

            // Find chain data if exists
            const chainData = chains.find(c => c.name && c.name.toLowerCase() === chainName);
            const isActive = activeChains.includes(chainName);

            if (sizeEl) {
                if (isActive && chainData) {
                    sizeEl.textContent = chainData.size || 0;
                } else {
                    sizeEl.textContent = '0';
                }
            }

            if (chainItem) {
                if (isActive) {
                    chainItem.classList.add('active');
                    chainItem.classList.remove('inactive');

                    // Check if safe (11+ tiles)
                    if (chainData && chainData.size >= 11) {
                        chainItem.classList.add('safe');
                    } else {
                        chainItem.classList.remove('safe');
                    }
                } else {
                    chainItem.classList.remove('active', 'safe');
                    chainItem.classList.add('inactive');
                }
            }
        });
    }

    /**
     * Update scoreboard with player information
     */
    function updateScoreboard(players, currentPlayerId, turnOrder) {
        if (!elements.playerScoresBody || !players) return;

        elements.playerScoresBody.innerHTML = '';

        // Sort players by turn order if available
        let playerList = Object.entries(players);
        if (turnOrder && turnOrder.length > 0) {
            playerList.sort((a, b) => {
                const indexA = turnOrder.indexOf(a[0]);
                const indexB = turnOrder.indexOf(b[0]);
                return indexA - indexB;
            });
        }

        playerList.forEach(([playerId, player]) => {
            const row = document.createElement('tr');
            const isCurrentTurn = playerId === currentPlayerId;

            if (isCurrentTurn) {
                row.classList.add('current-turn');
            }

            // Player name cell
            const nameCell = document.createElement('td');
            nameCell.textContent = player.name;
            if (isCurrentTurn) {
                nameCell.innerHTML = `<strong>${escapeHtml(player.name)}</strong>`;
            }
            row.appendChild(nameCell);

            // Money cell
            const moneyCell = document.createElement('td');
            moneyCell.textContent = formatMoney(player.money || 0);
            row.appendChild(moneyCell);

            // Stock cells for each chain
            const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
            const stocks = player.stocks || {};

            chains.forEach(chain => {
                const stockCell = document.createElement('td');
                stockCell.className = 'stock-col';
                const count = stocks[chain] || 0;
                stockCell.textContent = count > 0 ? count : '-';
                if (count > 0) {
                    stockCell.style.color = CHAIN_COLORS[chain];
                    stockCell.style.fontWeight = 'bold';
                }
                row.appendChild(stockCell);
            });

            elements.playerScoresBody.appendChild(row);
        });
    }

    /**
     * Update current player indicator
     */
    function updateCurrentPlayer(currentPlayerId, phase) {
        if (!elements.currentPlayer) return;

        if (currentPlayerId && gameState.players[currentPlayerId]) {
            const playerName = gameState.players[currentPlayerId].name;
            const phaseText = getPhaseDescription(phase);
            elements.currentPlayer.textContent = `${playerName} - ${phaseText}`;
            elements.currentPlayer.classList.remove('winner');
        } else {
            elements.currentPlayer.textContent = 'Waiting...';
        }
    }

    /**
     * Get human-readable phase description
     */
    function getPhaseDescription(phase) {
        const descriptions = {
            'place_tile': 'Place Tile',
            'found_chain': 'Found Chain',
            'buy_stocks': 'Buy Stocks',
            'merger': 'Merger'
        };
        return descriptions[phase] || phase || 'Waiting';
    }

    /**
     * Add entry to game log
     */
    function addLogEntry(message, type = 'info') {
        if (!elements.gameLog) return;

        const entry = document.createElement('p');
        entry.className = `log-entry log-${type}`;

        const timestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${escapeHtml(message)}`;

        // Add to beginning of log
        if (elements.gameLog.firstChild) {
            elements.gameLog.insertBefore(entry, elements.gameLog.firstChild);
        } else {
            elements.gameLog.appendChild(entry);
        }

        // Limit log entries
        while (elements.gameLog.children.length > CONFIG.maxLogEntries) {
            elements.gameLog.removeChild(elements.gameLog.lastChild);
        }
    }

    /**
     * Show error message
     */
    function showError(message) {
        addLogEntry(`ERROR: ${message}`, 'error');
        console.error(message);
    }

    // ==========================================================================
    // HOST CONTROLS
    // ==========================================================================

    /**
     * Add bot to the game
     */
    function addBot() {
        sendAction('add_bot');
        addLogEntry('Adding bot...');
    }

    /**
     * Start the game
     */
    function startGame() {
        sendAction('start_game');
        addLogEntry('Starting game...');
    }

    /**
     * End the game (host override)
     */
    function endGame() {
        if (confirm('Are you sure you want to end the game?')) {
            sendAction('end_game');
            addLogEntry('Ending game...');
        }
    }

    // ==========================================================================
    // UTILITY FUNCTIONS
    // ==========================================================================

    /**
     * Format money value
     */
    function formatMoney(amount) {
        return '$' + Number(amount).toLocaleString();
    }

    /**
     * Capitalize first letter
     */
    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================

    window.AcquireHost = {
        init: init,
        addBot: addBot,
        startGame: startGame,
        endGame: endGame,
        sendAction: sendAction,
        addLogEntry: addLogEntry,
        getGameState: () => gameState
    };

    // ==========================================================================
    // AUTO-INITIALIZE
    // ==========================================================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
