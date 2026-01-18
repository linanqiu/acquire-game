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
        heartbeatInterval: 30000
    };

    // ==========================================================================
    // STATE
    // ==========================================================================

    let ws = null;
    let roomCode = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;

    // ==========================================================================
    // DOM ELEMENTS
    // ==========================================================================

    const elements = {
        connectionStatus: null,
        boardGrid: null,
        scoreboard: null,
        chainInfo: null,
        gameLog: null
    };

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

        // Try URL query parameter
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('room');
    }

    /**
     * Cache DOM element references
     */
    function cacheElements() {
        elements.connectionStatus = document.getElementById('connection-status');
        elements.boardGrid = document.getElementById('board-grid');
        elements.scoreboard = document.getElementById('scoreboard');
        elements.scoreboardBody = document.getElementById('scoreboard-body');
        elements.chainInfo = document.getElementById('chain-info');
        elements.chainList = document.getElementById('chain-list');
        elements.gameLog = document.getElementById('game-log');
        elements.logEntries = document.getElementById('log-entries');
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
        const wsUrl = `${protocol}//${window.location.host}/ws/${roomCode}/host`;

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
    }

    /**
     * Handle incoming WebSocket message
     */
    function handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            processMessage(message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }

    /**
     * Process received message based on type
     */
    function processMessage(message) {
        const { type, data } = message;

        switch (type) {
            case 'board_update':
                updateBoard(data.cells);
                break;
            case 'player_update':
                updateScoreboard(data.players);
                break;
            case 'turn_change':
                handleTurnChange(data);
                break;
            case 'chain_update':
                updateChainInfo(data.chains);
                break;
            case 'game_log':
                addLogEntry(data.message, data.highlight);
                break;
            case 'game_state':
                // Full game state update
                if (data.board) updateBoard(data.board.cells);
                if (data.players) updateScoreboard(data.players);
                if (data.chains) updateChainInfo(data.chains);
                break;
            case 'game_over':
                handleGameOver(data);
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

    // ==========================================================================
    // UI UPDATE FUNCTIONS
    // ==========================================================================

    /**
     * Update connection status indicator
     */
    function updateConnectionStatus(status) {
        if (!elements.connectionStatus) return;

        elements.connectionStatus.className = 'connection-status ' + status;

        const statusText = {
            connected: 'Connected',
            disconnected: 'Disconnected',
            connecting: 'Connecting...'
        };

        elements.connectionStatus.textContent = statusText[status] || status;
    }

    /**
     * Update the game board with cell data
     * @param {Array} cells - Array of cell objects with position and state
     */
    function updateBoard(cells) {
        if (!elements.boardGrid) return;

        // Create cells if they don't exist
        if (elements.boardGrid.children.length === 0) {
            createBoardCells();
        }

        // Update each cell
        cells.forEach(cell => {
            const index = cell.row * 12 + cell.col;
            const cellElement = elements.boardGrid.children[index];

            if (cellElement) {
                updateCell(cellElement, cell);
            }
        });
    }

    /**
     * Create empty board cells
     */
    function createBoardCells() {
        elements.boardGrid.innerHTML = '';

        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 12; col++) {
                const cell = document.createElement('div');
                cell.className = 'board-cell empty';
                cell.dataset.row = row;
                cell.dataset.col = col;

                // Display cell coordinate (e.g., "1A", "12I")
                const colLabel = col + 1;
                const rowLabel = String.fromCharCode(65 + row); // A-I
                cell.textContent = `${colLabel}${rowLabel}`;

                elements.boardGrid.appendChild(cell);
            }
        }
    }

    /**
     * Update a single cell's appearance
     */
    function updateCell(cellElement, cell) {
        // Remove all state classes
        cellElement.classList.remove(
            'empty', 'played',
            'luxor', 'tower', 'american', 'worldwide',
            'festival', 'imperial', 'continental'
        );

        // Add appropriate class based on state
        if (cell.chain) {
            cellElement.classList.add(cell.chain.toLowerCase());
        } else if (cell.played) {
            cellElement.classList.add('played');
        } else {
            cellElement.classList.add('empty');
        }
    }

    /**
     * Update scoreboard with player information
     * @param {Array} players - Array of player objects
     */
    function updateScoreboard(players) {
        if (!elements.scoreboardBody) return;

        const chains = ['luxor', 'tower', 'american', 'worldwide', 'festival', 'imperial', 'continental'];

        elements.scoreboardBody.innerHTML = '';

        players.forEach(player => {
            const row = document.createElement('tr');

            if (player.isCurrentTurn) {
                row.classList.add('current-turn');
            }

            // Player name
            const nameCell = document.createElement('td');
            nameCell.className = 'scoreboard-player-name';
            nameCell.textContent = player.name;
            row.appendChild(nameCell);

            // Money
            const moneyCell = document.createElement('td');
            moneyCell.textContent = formatMoney(player.money);
            row.appendChild(moneyCell);

            // Stock counts for each chain
            chains.forEach(chain => {
                const stockCell = document.createElement('td');
                stockCell.className = 'stock-count';
                const count = player.stocks ? (player.stocks[chain] || 0) : 0;
                stockCell.textContent = count > 0 ? count : '-';
                row.appendChild(stockCell);
            });

            elements.scoreboardBody.appendChild(row);
        });
    }

    /**
     * Update chain information display
     * @param {Array} chains - Array of chain objects with size, price, etc.
     */
    function updateChainInfo(chains) {
        if (!elements.chainList) return;

        elements.chainList.innerHTML = '';

        const chainOrder = ['luxor', 'tower', 'american', 'worldwide', 'festival', 'imperial', 'continental'];

        chainOrder.forEach(chainName => {
            const chain = chains.find(c => c.name.toLowerCase() === chainName) || {
                name: chainName,
                size: 0,
                price: 0,
                stocksRemaining: 25,
                active: false,
                safe: false
            };

            const item = document.createElement('div');
            item.className = `chain-item ${chainName}`;

            if (!chain.active) {
                item.classList.add('inactive');
            }

            if (chain.safe) {
                item.classList.add('safe');
            }

            item.innerHTML = `
                <span class="chain-name">${capitalize(chain.name)}</span>
                <span class="chain-size">${chain.size || '-'}</span>
                <span class="chain-price">${chain.price ? formatMoney(chain.price) : '-'}</span>
                <span class="chain-stocks-remaining">${chain.stocksRemaining} left</span>
            `;

            elements.chainList.appendChild(item);
        });
    }

    /**
     * Handle turn change event
     */
    function handleTurnChange(data) {
        addLogEntry(`It's ${data.playerName}'s turn`, true);

        // Update scoreboard to highlight current player
        if (data.players) {
            updateScoreboard(data.players);
        }
    }

    /**
     * Add entry to game log
     * @param {string} message - Log message
     * @param {boolean} highlight - Whether to highlight this entry
     */
    function addLogEntry(message, highlight = false) {
        if (!elements.logEntries) return;

        const entry = document.createElement('div');
        entry.className = 'log-entry';

        if (highlight) {
            entry.classList.add('highlight');
        }

        const timestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        entry.innerHTML = `
            <span class="timestamp">${timestamp}</span>
            ${escapeHtml(message)}
        `;

        // Add to top of log
        elements.logEntries.insertBefore(entry, elements.logEntries.firstChild);

        // Limit log entries
        while (elements.logEntries.children.length > 100) {
            elements.logEntries.removeChild(elements.logEntries.lastChild);
        }
    }

    /**
     * Handle game over event
     */
    function handleGameOver(data) {
        addLogEntry('Game Over!', true);

        if (data.winner) {
            addLogEntry(`${data.winner.name} wins with ${formatMoney(data.winner.totalValue)}!`, true);
        }

        if (data.finalStandings) {
            data.finalStandings.forEach((player, index) => {
                addLogEntry(`${index + 1}. ${player.name}: ${formatMoney(player.totalValue)}`);
            });
        }
    }

    /**
     * Show error message to user
     */
    function showError(message) {
        addLogEntry(`ERROR: ${message}`, true);

        // Also show alert for critical errors
        if (elements.gameLog) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = message;
            errorDiv.style.cssText = `
                background-color: var(--error);
                color: white;
                padding: var(--spacing-md);
                border-radius: var(--radius-md);
                margin-bottom: var(--spacing-md);
                text-align: center;
            `;
            elements.gameLog.parentNode.insertBefore(errorDiv, elements.gameLog);
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
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================

    window.AcquireHost = {
        init: init,
        updateBoard: updateBoard,
        updateScoreboard: updateScoreboard,
        updateChainInfo: updateChainInfo,
        addLogEntry: addLogEntry
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
