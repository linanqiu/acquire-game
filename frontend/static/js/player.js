/**
 * ACQUIRE Board Game - Player View JavaScript
 * Manages WebSocket connection and player interactions for mobile devices
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
    let playerId = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;
    let isMyTurn = false;
    let selectedTile = null;
    let currentAction = null;
    let gameState = {
        tiles: [],
        money: 0,
        stocks: {},
        chains: []
    };

    // ==========================================================================
    // DOM ELEMENTS
    // ==========================================================================

    const elements = {
        connectionStatus: null,
        turnIndicator: null,
        tileRack: null,
        moneyDisplay: null,
        stockDisplay: null,
        actionPanel: null
    };

    // ==========================================================================
    // INITIALIZATION
    // ==========================================================================

    /**
     * Initialize the player view
     */
    function init() {
        // Get room code and player ID from page
        const credentials = getCredentials();
        roomCode = credentials.roomCode;
        playerId = credentials.playerId;

        if (!roomCode || !playerId) {
            console.error('Missing room code or player ID');
            showError('Session not found. Please rejoin the game.');
            return;
        }

        // Cache DOM elements
        cacheElements();

        // Set up event listeners
        setupEventListeners();

        // Connect to WebSocket
        connect();

        // Window event handlers
        window.addEventListener('beforeunload', cleanup);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Prevent pull-to-refresh on mobile
        document.body.addEventListener('touchmove', preventOverscroll, { passive: false });
    }

    /**
     * Get credentials from page
     */
    function getCredentials() {
        // Try data attributes first
        const container = document.querySelector('[data-room-code]');
        if (container) {
            return {
                roomCode: container.dataset.roomCode,
                playerId: container.dataset.playerId
            };
        }

        // Try URL path (e.g., /play/ABCD/player123)
        const pathMatch = window.location.pathname.match(/\/play\/([A-Z0-9]+)\/([^\/]+)/i);
        if (pathMatch) {
            return {
                roomCode: pathMatch[1].toUpperCase(),
                playerId: pathMatch[2]
            };
        }

        // Try URL query parameters
        const urlParams = new URLSearchParams(window.location.search);
        return {
            roomCode: urlParams.get('room'),
            playerId: urlParams.get('player')
        };
    }

    /**
     * Cache DOM element references
     */
    function cacheElements() {
        elements.connectionStatus = document.getElementById('connection-status');
        elements.turnIndicator = document.getElementById('turn-indicator');
        elements.tileRack = document.getElementById('tile-rack');
        elements.moneyDisplay = document.getElementById('money-amount');
        elements.stockDisplay = document.getElementById('stock-display');
        elements.stockGrid = document.getElementById('stock-grid');
        elements.actionPanel = document.getElementById('action-panel');
        elements.actionPanelTitle = document.getElementById('action-panel-title');
        elements.actionPanelContent = document.getElementById('action-panel-content');
        elements.confirmBtn = document.getElementById('confirm-action-btn');
        elements.cancelBtn = document.getElementById('cancel-action-btn');
    }

    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        // Confirm and cancel buttons
        if (elements.confirmBtn) {
            elements.confirmBtn.addEventListener('click', handleConfirm);
        }
        if (elements.cancelBtn) {
            elements.cancelBtn.addEventListener('click', handleCancel);
        }
    }

    /**
     * Prevent overscroll/pull-to-refresh
     */
    function preventOverscroll(e) {
        if (e.target.closest('.game-log, .stock-display')) {
            return; // Allow scrolling in these containers
        }
        if (document.body.scrollTop === 0) {
            e.preventDefault();
        }
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
        const wsUrl = `${protocol}//${window.location.host}/ws/${roomCode}/${playerId}`;

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
            case 'player_update':
                handlePlayerUpdate(data);
                break;
            case 'turn_change':
                handleTurnChange(data);
                break;
            case 'action_required':
                handleActionRequired(data);
                break;
            case 'action_result':
                handleActionResult(data);
                break;
            case 'game_state':
                handleFullGameState(data);
                break;
            case 'chain_update':
                gameState.chains = data.chains;
                break;
            case 'game_over':
                handleGameOver(data);
                break;
            case 'error':
                showError(data.message);
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
            showError('Connection lost. Please refresh the page to rejoin.');
            return;
        }

        reconnectAttempts++;
        const delay = CONFIG.reconnectDelay * Math.min(reconnectAttempts, 5);

        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
        setTimeout(connect, delay);
    }

    /**
     * Start heartbeat
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
     * Stop heartbeat
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
     * Handle browser online
     */
    function handleOnline() {
        console.log('Browser online, reconnecting...');
        connect();
    }

    /**
     * Handle browser offline
     */
    function handleOffline() {
        console.log('Browser offline');
        updateConnectionStatus('disconnected');
    }

    // ==========================================================================
    // SEND ACTIONS TO SERVER
    // ==========================================================================

    /**
     * Send action to server
     * @param {string} type - Action type
     * @param {Object} data - Action data
     */
    function sendAction(type, data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showError('Not connected. Please wait...');
            return false;
        }

        const message = {
            type: 'action',
            action: type,
            data: data
        };

        ws.send(JSON.stringify(message));
        return true;
    }

    /**
     * Place a tile on the board
     * @param {Object} tile - Tile to place { row, col }
     */
    function placeTile(tile) {
        return sendAction('place_tile', {
            row: tile.row,
            col: tile.col
        });
    }

    /**
     * Found a new hotel chain
     * @param {string} chainName - Name of chain to found
     */
    function foundChain(chainName) {
        return sendAction('found_chain', {
            chain: chainName
        });
    }

    /**
     * Buy stocks
     * @param {Object} stocks - Stocks to buy { chainName: quantity }
     */
    function buyStocks(stocks) {
        return sendAction('buy_stocks', {
            stocks: stocks
        });
    }

    /**
     * Make merger decision
     * @param {Object} decision - Merger decision { sell, trade, keep }
     */
    function mergerDecision(decision) {
        return sendAction('merger_decision', {
            sell: decision.sell || 0,
            trade: decision.trade || 0,
            keep: decision.keep || 0
        });
    }

    /**
     * Choose surviving chain in merger
     * @param {string} chainName - Name of surviving chain
     */
    function chooseSurvivor(chainName) {
        return sendAction('choose_survivor', {
            chain: chainName
        });
    }

    /**
     * End the game (when conditions are met)
     */
    function endGame() {
        return sendAction('end_game', {});
    }

    // ==========================================================================
    // MESSAGE HANDLERS
    // ==========================================================================

    /**
     * Handle player update message
     */
    function handlePlayerUpdate(data) {
        if (data.tiles !== undefined) {
            updateTiles(data.tiles);
        }
        if (data.money !== undefined) {
            updateMoney(data.money);
        }
        if (data.stocks !== undefined) {
            updateStocks(data.stocks);
        }
    }

    /**
     * Handle turn change message
     */
    function handleTurnChange(data) {
        isMyTurn = data.currentPlayerId === playerId;
        updateTurnIndicator(isMyTurn, data.playerName);

        if (!isMyTurn) {
            hideActionPanel();
            selectedTile = null;
            clearTileSelection();
        }
    }

    /**
     * Handle action required message
     */
    function handleActionRequired(data) {
        currentAction = data.action;

        switch (data.action) {
            case 'place_tile':
                showPlaceTileUI();
                break;
            case 'found_chain':
                showFoundChainUI(data.availableChains);
                break;
            case 'buy_stocks':
                showBuyStocksUI(data.availableChains, data.maxPurchase || 3);
                break;
            case 'merger_decision':
                showMergerDecisionUI(data);
                break;
            case 'choose_survivor':
                showChooseSurvivorUI(data.chains);
                break;
            case 'choose_defunct':
                showChooseDefunctUI(data.chains);
                break;
            case 'end_game_option':
                showEndGameOptionUI();
                break;
            default:
                console.log('Unknown action required:', data.action);
        }
    }

    /**
     * Handle action result message
     */
    function handleActionResult(data) {
        if (data.success) {
            hideActionPanel();
            currentAction = null;
        } else {
            showError(data.message || 'Action failed');
        }
    }

    /**
     * Handle full game state message
     */
    function handleFullGameState(data) {
        if (data.tiles) updateTiles(data.tiles);
        if (data.money !== undefined) updateMoney(data.money);
        if (data.stocks) updateStocks(data.stocks);
        if (data.chains) gameState.chains = data.chains;
        if (data.isYourTurn !== undefined) {
            isMyTurn = data.isYourTurn;
            updateTurnIndicator(isMyTurn);
        }
    }

    /**
     * Handle game over message
     */
    function handleGameOver(data) {
        isMyTurn = false;
        hideActionPanel();
        updateTurnIndicator(false, 'Game Over');

        // Show game over UI
        showGameOverUI(data);
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
     * Update turn indicator
     */
    function updateTurnIndicator(myTurn, playerName) {
        if (!elements.turnIndicator) return;

        if (myTurn) {
            elements.turnIndicator.className = 'turn-indicator';
            elements.turnIndicator.textContent = 'Your Turn';
        } else {
            elements.turnIndicator.className = 'turn-indicator not-your-turn';
            elements.turnIndicator.textContent = playerName ? `${playerName}'s Turn` : 'Waiting...';
        }
    }

    /**
     * Update tile rack display
     * @param {Array} tiles - Array of tile objects
     */
    function updateTiles(tiles) {
        if (!elements.tileRack) return;

        gameState.tiles = tiles;
        elements.tileRack.innerHTML = '';

        tiles.forEach((tile, index) => {
            const tileElement = document.createElement('div');
            tileElement.className = 'tile';

            if (tile.disabled) {
                tileElement.classList.add('disabled');
            }

            if (selectedTile && selectedTile.row === tile.row && selectedTile.col === tile.col) {
                tileElement.classList.add('selected');
            }

            // Display tile coordinate
            const colLabel = tile.col + 1;
            const rowLabel = String.fromCharCode(65 + tile.row);
            tileElement.textContent = `${colLabel}${rowLabel}`;

            tileElement.dataset.row = tile.row;
            tileElement.dataset.col = tile.col;
            tileElement.dataset.index = index;

            // Touch and click handlers
            tileElement.addEventListener('click', () => handleTileClick(tile, tileElement));
            tileElement.addEventListener('touchend', (e) => {
                e.preventDefault();
                handleTileClick(tile, tileElement);
            });

            elements.tileRack.appendChild(tileElement);
        });
    }

    /**
     * Handle tile click
     */
    function handleTileClick(tile, tileElement) {
        if (tile.disabled || !isMyTurn || currentAction !== 'place_tile') {
            return;
        }

        // Clear previous selection
        clearTileSelection();

        // Select this tile
        selectedTile = tile;
        tileElement.classList.add('selected');

        // Show confirmation
        showTileConfirmation(tile);
    }

    /**
     * Clear tile selection
     */
    function clearTileSelection() {
        const tiles = elements.tileRack.querySelectorAll('.tile');
        tiles.forEach(t => t.classList.remove('selected'));
    }

    /**
     * Update money display
     * @param {number} amount - Current money amount
     */
    function updateMoney(amount) {
        if (!elements.moneyDisplay) return;

        gameState.money = amount;
        elements.moneyDisplay.textContent = formatMoney(amount);
    }

    /**
     * Update stock portfolio display
     * @param {Object} stocks - Stock holdings { chainName: quantity }
     */
    function updateStocks(stocks) {
        if (!elements.stockGrid) return;

        gameState.stocks = stocks;
        elements.stockGrid.innerHTML = '';

        const chainOrder = ['luxor', 'tower', 'american', 'worldwide', 'festival', 'imperial', 'continental'];

        chainOrder.forEach(chain => {
            const count = stocks[chain] || 0;
            const item = document.createElement('div');
            item.className = `stock-item ${chain}`;

            item.innerHTML = `
                <span class="stock-item-name">${chain.substring(0, 3).toUpperCase()}</span>
                <span class="stock-item-count">${count}</span>
            `;

            elements.stockGrid.appendChild(item);
        });
    }

    // ==========================================================================
    // ACTION UI PANELS
    // ==========================================================================

    /**
     * Show action panel
     */
    function showActionPanel(title, content) {
        if (!elements.actionPanel) return;

        if (elements.actionPanelTitle) {
            elements.actionPanelTitle.textContent = title;
        }

        if (elements.actionPanelContent) {
            elements.actionPanelContent.innerHTML = '';
            if (typeof content === 'string') {
                elements.actionPanelContent.innerHTML = content;
            } else {
                elements.actionPanelContent.appendChild(content);
            }
        }

        elements.actionPanel.classList.add('active');
    }

    /**
     * Hide action panel
     */
    function hideActionPanel() {
        if (elements.actionPanel) {
            elements.actionPanel.classList.remove('active');
        }
    }

    /**
     * Show place tile UI
     */
    function showPlaceTileUI() {
        updateTurnIndicator(true);
        // Tiles are already clickable, just ensure they're enabled
        const tiles = elements.tileRack.querySelectorAll('.tile:not(.disabled)');
        if (tiles.length === 0) {
            showError('No playable tiles available');
        }
    }

    /**
     * Show tile confirmation
     */
    function showTileConfirmation(tile) {
        const colLabel = tile.col + 1;
        const rowLabel = String.fromCharCode(65 + tile.row);

        const content = document.createElement('div');
        content.innerHTML = `
            <p style="text-align: center; margin-bottom: var(--spacing-md);">
                Place tile <strong>${colLabel}${rowLabel}</strong>?
            </p>
            <div class="action-buttons">
                <button class="btn btn-primary" id="confirm-tile-btn">Place Tile</button>
                <button class="btn btn-secondary" id="cancel-tile-btn">Cancel</button>
            </div>
        `;

        showActionPanel('Place Tile', content);

        document.getElementById('confirm-tile-btn').addEventListener('click', () => {
            if (placeTile(selectedTile)) {
                hideActionPanel();
            }
        });

        document.getElementById('cancel-tile-btn').addEventListener('click', () => {
            selectedTile = null;
            clearTileSelection();
            hideActionPanel();
        });
    }

    /**
     * Show found chain UI
     */
    function showFoundChainUI(availableChains) {
        const content = document.createElement('div');
        content.className = 'chain-selection';

        availableChains.forEach(chain => {
            const btn = document.createElement('button');
            btn.className = `chain-select-btn ${chain.toLowerCase()}`;
            btn.innerHTML = `<span class="chain-name">${capitalize(chain)}</span>`;

            btn.addEventListener('click', () => {
                if (foundChain(chain)) {
                    hideActionPanel();
                }
            });

            content.appendChild(btn);
        });

        showActionPanel('Found a Chain', content);
    }

    /**
     * Show buy stocks UI
     */
    function showBuyStocksUI(availableChains, maxPurchase) {
        const purchases = {};
        let totalCost = 0;

        const content = document.createElement('div');
        content.className = 'stock-purchase-panel';

        // Create purchase controls for each chain
        availableChains.forEach(chain => {
            const chainInfo = gameState.chains.find(c => c.name.toLowerCase() === chain.name.toLowerCase()) || chain;
            purchases[chain.name] = 0;

            const item = document.createElement('div');
            item.className = 'stock-purchase-item';
            item.innerHTML = `
                <div class="stock-purchase-info">
                    <span class="stock-purchase-name" style="color: var(--chain-${chain.name.toLowerCase()})">${capitalize(chain.name)}</span>
                    <span class="stock-purchase-price">${formatMoney(chain.price)} each (${chain.available} available)</span>
                </div>
                <div class="stock-purchase-controls">
                    <button class="quantity-btn minus" data-chain="${chain.name}">-</button>
                    <span class="quantity-display" id="qty-${chain.name}">0</span>
                    <button class="quantity-btn plus" data-chain="${chain.name}">+</button>
                </div>
            `;

            content.appendChild(item);
        });

        // Total and buttons
        const footer = document.createElement('div');
        footer.innerHTML = `
            <div style="text-align: center; margin: var(--spacing-md) 0;">
                <span>Total: </span>
                <span id="purchase-total" style="font-weight: bold; color: var(--success);">$0</span>
                <span style="color: var(--text-muted);"> / ${formatMoney(gameState.money)}</span>
            </div>
            <div class="action-buttons">
                <button class="btn btn-primary" id="confirm-purchase-btn">Buy Stocks</button>
                <button class="btn btn-secondary" id="skip-purchase-btn">Skip</button>
            </div>
        `;
        content.appendChild(footer);

        showActionPanel('Buy Stocks (Max 3)', content);

        // Add event listeners for quantity buttons
        const updateTotal = () => {
            totalCost = 0;
            let totalQty = 0;
            availableChains.forEach(chain => {
                totalCost += purchases[chain.name] * chain.price;
                totalQty += purchases[chain.name];
            });
            document.getElementById('purchase-total').textContent = formatMoney(totalCost);

            // Enable/disable confirm button
            const confirmBtn = document.getElementById('confirm-purchase-btn');
            confirmBtn.disabled = totalCost > gameState.money;
        };

        content.querySelectorAll('.quantity-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const chain = btn.dataset.chain;
                const chainData = availableChains.find(c => c.name === chain);
                const isPlus = btn.classList.contains('plus');

                let currentQty = purchases[chain];
                let totalQty = Object.values(purchases).reduce((a, b) => a + b, 0);

                if (isPlus) {
                    if (totalQty < maxPurchase && currentQty < chainData.available) {
                        purchases[chain]++;
                    }
                } else {
                    if (currentQty > 0) {
                        purchases[chain]--;
                    }
                }

                document.getElementById(`qty-${chain}`).textContent = purchases[chain];
                updateTotal();
            });
        });

        document.getElementById('confirm-purchase-btn').addEventListener('click', () => {
            const stocksToBuy = {};
            for (const [chain, qty] of Object.entries(purchases)) {
                if (qty > 0) {
                    stocksToBuy[chain] = qty;
                }
            }
            if (buyStocks(stocksToBuy)) {
                hideActionPanel();
            }
        });

        document.getElementById('skip-purchase-btn').addEventListener('click', () => {
            if (buyStocks({})) {
                hideActionPanel();
            }
        });
    }

    /**
     * Show merger decision UI
     */
    function showMergerDecisionUI(data) {
        const { defunctChain, survivingChain, stockCount, bonuses } = data;
        const decision = { sell: 0, trade: 0, keep: stockCount };

        const content = document.createElement('div');
        content.className = 'merger-decision-panel';

        content.innerHTML = `
            <div class="merger-info">
                <p><strong>${capitalize(defunctChain)}</strong> is being merged into <strong>${capitalize(survivingChain)}</strong></p>
                <p>You have <span class="merger-stock-count">${stockCount}</span> ${capitalize(defunctChain)} stocks</p>
                ${bonuses ? `<p style="color: var(--success);">Bonus: ${formatMoney(bonuses.majority)} (majority) / ${formatMoney(bonuses.minority)} (minority)</p>` : ''}
            </div>
            <div class="merger-options">
                <div class="merger-option">
                    <span class="merger-option-label">Sell (${data.sellPrice ? formatMoney(data.sellPrice) + ' each' : ''})</span>
                    <div class="merger-option-controls">
                        <button class="quantity-btn minus" data-option="sell">-</button>
                        <span class="quantity-display" id="merger-sell">0</span>
                        <button class="quantity-btn plus" data-option="sell">+</button>
                    </div>
                </div>
                <div class="merger-option">
                    <span class="merger-option-label">Trade (2:1 for ${capitalize(survivingChain)})</span>
                    <div class="merger-option-controls">
                        <button class="quantity-btn minus" data-option="trade">-</button>
                        <span class="quantity-display" id="merger-trade">0</span>
                        <button class="quantity-btn plus" data-option="trade">+</button>
                    </div>
                </div>
                <div class="merger-option">
                    <span class="merger-option-label">Keep</span>
                    <div class="merger-option-controls">
                        <span class="quantity-display" id="merger-keep">${stockCount}</span>
                    </div>
                </div>
            </div>
            <div class="action-buttons" style="margin-top: var(--spacing-md);">
                <button class="btn btn-primary" id="confirm-merger-btn">Confirm</button>
            </div>
        `;

        showActionPanel('Merger Decision', content);

        const updateKeep = () => {
            decision.keep = stockCount - decision.sell - decision.trade;
            document.getElementById('merger-keep').textContent = decision.keep;
        };

        content.querySelectorAll('.quantity-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const option = btn.dataset.option;
                const isPlus = btn.classList.contains('plus');

                if (option === 'sell') {
                    if (isPlus && decision.sell + decision.trade < stockCount) {
                        decision.sell++;
                    } else if (!isPlus && decision.sell > 0) {
                        decision.sell--;
                    }
                    document.getElementById('merger-sell').textContent = decision.sell;
                } else if (option === 'trade') {
                    // Trade must be in pairs of 2
                    if (isPlus && decision.sell + decision.trade + 2 <= stockCount) {
                        decision.trade += 2;
                    } else if (!isPlus && decision.trade >= 2) {
                        decision.trade -= 2;
                    }
                    document.getElementById('merger-trade').textContent = decision.trade;
                }

                updateKeep();
            });
        });

        document.getElementById('confirm-merger-btn').addEventListener('click', () => {
            if (mergerDecision(decision)) {
                hideActionPanel();
            }
        });
    }

    /**
     * Show choose survivor UI (for tie-breaker)
     */
    function showChooseSurvivorUI(chains) {
        const content = document.createElement('div');
        content.innerHTML = '<p style="text-align: center; margin-bottom: var(--spacing-md);">Choose which chain survives:</p>';

        const selection = document.createElement('div');
        selection.className = 'chain-selection';

        chains.forEach(chain => {
            const btn = document.createElement('button');
            btn.className = `chain-select-btn ${chain.toLowerCase()}`;
            btn.innerHTML = `<span class="chain-name">${capitalize(chain)}</span>`;

            btn.addEventListener('click', () => {
                if (chooseSurvivor(chain)) {
                    hideActionPanel();
                }
            });

            selection.appendChild(btn);
        });

        content.appendChild(selection);
        showActionPanel('Choose Surviving Chain', content);
    }

    /**
     * Show choose defunct chain UI (for multiple mergers)
     */
    function showChooseDefunctUI(chains) {
        const content = document.createElement('div');
        content.innerHTML = '<p style="text-align: center; margin-bottom: var(--spacing-md);">Choose which chain to merge first:</p>';

        const selection = document.createElement('div');
        selection.className = 'chain-selection';

        chains.forEach(chain => {
            const btn = document.createElement('button');
            btn.className = `chain-select-btn ${chain.name.toLowerCase()}`;
            btn.innerHTML = `
                <span class="chain-name">${capitalize(chain.name)}</span>
                <span style="font-size: 0.75rem;">Size: ${chain.size}</span>
            `;

            btn.addEventListener('click', () => {
                if (sendAction('choose_defunct', { chain: chain.name })) {
                    hideActionPanel();
                }
            });

            selection.appendChild(btn);
        });

        content.appendChild(selection);
        showActionPanel('Choose Chain to Merge', content);
    }

    /**
     * Show end game option UI
     */
    function showEndGameOptionUI() {
        const content = document.createElement('div');
        content.innerHTML = `
            <p style="text-align: center; margin-bottom: var(--spacing-md);">
                Game can be ended. Do you want to end it now?
            </p>
            <div class="action-buttons">
                <button class="btn btn-warning" id="end-game-btn">End Game</button>
                <button class="btn btn-secondary" id="continue-game-btn">Continue Playing</button>
            </div>
        `;

        showActionPanel('End Game?', content);

        document.getElementById('end-game-btn').addEventListener('click', () => {
            if (endGame()) {
                hideActionPanel();
            }
        });

        document.getElementById('continue-game-btn').addEventListener('click', () => {
            if (sendAction('continue_game', {})) {
                hideActionPanel();
            }
        });
    }

    /**
     * Show game over UI
     */
    function showGameOverUI(data) {
        const content = document.createElement('div');

        let html = '<h2 style="text-align: center; color: var(--accent); margin-bottom: var(--spacing-md);">Game Over!</h2>';

        if (data.winner) {
            html += `<p style="text-align: center; font-size: 1.25rem; margin-bottom: var(--spacing-md);">
                <strong>${data.winner.name}</strong> wins with ${formatMoney(data.winner.totalValue)}!
            </p>`;
        }

        if (data.finalStandings) {
            html += '<div style="margin-top: var(--spacing-md);">';
            data.finalStandings.forEach((player, index) => {
                const isMe = player.id === playerId;
                html += `
                    <div style="display: flex; justify-content: space-between; padding: var(--spacing-sm);
                                ${isMe ? 'background-color: rgba(233, 69, 96, 0.2); border-radius: var(--radius-sm);' : ''}">
                        <span>${index + 1}. ${player.name} ${isMe ? '(You)' : ''}</span>
                        <span style="font-weight: bold;">${formatMoney(player.totalValue)}</span>
                    </div>
                `;
            });
            html += '</div>';
        }

        content.innerHTML = html;
        showActionPanel('Final Results', content);
    }

    /**
     * Handle confirm button click
     */
    function handleConfirm() {
        // Generic confirm handler - specific actions override this
    }

    /**
     * Handle cancel button click
     */
    function handleCancel() {
        hideActionPanel();
        selectedTile = null;
        clearTileSelection();
    }

    /**
     * Show error message
     */
    function showError(message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background-color: var(--error);
            color: white;
            padding: var(--spacing-sm) var(--spacing-md);
            border-radius: var(--radius-md);
            z-index: 1000;
            animation: fadeInOut 3s forwards;
        `;
        toast.textContent = message;

        // Add animation keyframes if not already added
        if (!document.getElementById('toast-animation')) {
            const style = document.createElement('style');
            style.id = 'toast-animation';
            style.textContent = `
                @keyframes fadeInOut {
                    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
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

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================

    window.AcquirePlayer = {
        init: init,
        updateTiles: updateTiles,
        updateMoney: updateMoney,
        updateStocks: updateStocks,
        sendAction: sendAction,
        placeTile: placeTile,
        foundChain: foundChain,
        buyStocks: buyStocks,
        mergerDecision: mergerDecision
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
