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

    // Chain colors for UI display
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
    let playerId = null;
    let playerName = null;
    let reconnectAttempts = 0;
    let heartbeatTimer = null;
    let isMyTurn = false;
    let selectedTile = null;
    let currentPhase = null;
    let gameState = {
        tiles: [],
        money: 6000,
        stocks: {},
        chains: {},
        board: null,
        currentPlayer: null,
        phase: null,
        players: {}
    };

    // ==========================================================================
    // DOM ELEMENTS
    // ==========================================================================

    const elements = {};

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
        elements.playerName = document.getElementById('player-name');
        elements.playerMoney = document.getElementById('player-money');
        elements.tileRack = document.getElementById('tile-rack');
        elements.portfolioTable = document.getElementById('portfolio-table');
        elements.actionSection = document.getElementById('action-section');
        elements.actionButtons = document.getElementById('action-buttons');
        elements.waitingMessage = document.getElementById('waiting-message');
        elements.buyStocksSection = document.getElementById('buy-stocks-section');
        elements.mergerSection = document.getElementById('merger-section');
        elements.chooseChainSection = document.getElementById('choose-chain-section');
        elements.gameStatus = document.getElementById('game-status');
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
                sendAction('buy_stocks', { purchases: {} });
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

        if (sellMinus) sellMinus.addEventListener('click', () => adjustMergerQuantity('sell', -1));
        if (sellPlus) sellPlus.addEventListener('click', () => adjustMergerQuantity('sell', 1));
        if (tradeMinus) tradeMinus.addEventListener('click', () => adjustMergerQuantity('trade', -2));
        if (tradePlus) tradePlus.addEventListener('click', () => adjustMergerQuantity('trade', 2));
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
        const wsUrl = `${protocol}//${window.location.host}/ws/player/${roomCode}/${playerId}`;

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
            case 'choose_chain':
                showFoundChainUI(message.available_chains);
                break;
            case 'choose_merger_survivor':
                showChooseSurvivorUI(message.tied_chains);
                break;
            case 'merger_disposition':
                showMergerDispositionUI(message);
                break;
            case 'can_end_game':
                showEndGameOption(message.message);
                break;
            case 'game_over':
                handleGameOver(message);
                break;
            case 'error':
                showError(message.message);
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
     * @param {string} action - Action type
     * @param {Object} data - Action data
     */
    function sendAction(action, data = {}) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showError('Not connected. Please wait...');
            return false;
        }

        const message = {
            action: action,
            ...data
        };

        console.log('Sending action:', message);
        ws.send(JSON.stringify(message));
        return true;
    }

    /**
     * Place a tile on the board
     * @param {string} tileStr - Tile string like "1A" or "12I"
     */
    function placeTile(tileStr) {
        return sendAction('place_tile', { tile: tileStr });
    }

    /**
     * Found a new hotel chain
     * @param {string} chainName - Name of chain to found
     */
    function foundChain(chainName) {
        return sendAction('found_chain', { chain: chainName });
    }

    /**
     * Buy stocks
     * @param {Object} purchases - Stocks to buy { chainName: quantity }
     */
    function buyStocks(purchases) {
        return sendAction('buy_stocks', { purchases: purchases });
    }

    /**
     * Make merger disposition decision
     * @param {string} defunctChain - Name of defunct chain
     * @param {Object} disposition - Decision { sell, trade, hold }
     */
    function mergerDisposition(defunctChain, disposition) {
        return sendAction('merger_disposition', {
            defunct_chain: defunctChain,
            disposition: disposition
        });
    }

    /**
     * Choose surviving chain in merger
     * @param {string} chainName - Name of surviving chain
     */
    function chooseSurvivor(chainName) {
        return sendAction('merger_choice', { surviving_chain: chainName });
    }

    /**
     * End the current turn
     */
    function endTurn() {
        return sendAction('end_turn', {});
    }

    // ==========================================================================
    // MESSAGE HANDLERS
    // ==========================================================================

    /**
     * Handle full game state message
     */
    function handleGameState(data) {
        // Update local game state
        gameState.board = data.board;
        gameState.chains = data.hotel || {};
        gameState.players = data.players || {};
        gameState.phase = data.phase;
        gameState.currentPlayer = data.current_player;

        // Update player's hand from your_hand
        if (data.your_hand) {
            gameState.tiles = data.your_hand;
            updateTileRack(data.your_hand);
        }

        // Update money from players data
        if (data.players && data.players[playerId]) {
            const myData = data.players[playerId];
            gameState.money = myData.money;
            gameState.stocks = myData.stocks || {};
            updateMoney(myData.money);
            updateStockPortfolio(myData.stocks || {});
        }

        // Determine if it's my turn
        isMyTurn = data.current_player === playerId;
        updateTurnIndicator(isMyTurn, data.phase);

        // Update UI based on phase
        updatePhaseUI(data.phase, isMyTurn);
    }

    /**
     * Handle lobby update
     */
    function handleLobbyUpdate(data) {
        // Game hasn't started yet, show waiting message
        if (elements.waitingMessage) {
            elements.waitingMessage.textContent = `Waiting for game to start... (${data.players.length} players)`;
            elements.waitingMessage.style.display = 'block';
        }
    }

    /**
     * Handle game over message
     */
    function handleGameOver(data) {
        isMyTurn = false;
        hideAllActionPanels();

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

    // ==========================================================================
    // UI UPDATE FUNCTIONS
    // ==========================================================================

    /**
     * Update connection status indicator
     */
    function updateConnectionStatus(status) {
        if (!elements.gameStatus) return;

        const indicator = elements.gameStatus.querySelector('.status-indicator');
        const text = elements.gameStatus.querySelector('.status-text');

        if (indicator) {
            indicator.className = 'status-indicator ' + status;
        }

        if (text) {
            const statusText = {
                connected: 'Connected',
                disconnected: 'Disconnected',
                connecting: 'Connecting...'
            };
            text.textContent = statusText[status] || status;
        }
    }

    /**
     * Update turn indicator and show appropriate message
     */
    function updateTurnIndicator(myTurn, phase) {
        if (elements.waitingMessage) {
            if (myTurn) {
                const phaseMessages = {
                    'place_tile': 'Your turn - Place a tile',
                    'found_chain': 'Your turn - Found a chain',
                    'buy_stocks': 'Your turn - Buy stocks',
                    'merger': 'Your turn - Handle merger'
                };
                elements.waitingMessage.textContent = phaseMessages[phase] || 'Your turn';
                elements.waitingMessage.classList.add('your-turn');
            } else {
                elements.waitingMessage.textContent = 'Waiting for other player...';
                elements.waitingMessage.classList.remove('your-turn');
            }
        }
    }

    /**
     * Update tile rack display
     * @param {Array} tiles - Array of tile strings like ["1A", "5C", "12I"]
     */
    function updateTileRack(tiles) {
        if (!elements.tileRack) return;

        const tileButtons = elements.tileRack.querySelectorAll('.tile');

        tileButtons.forEach((btn, index) => {
            if (index < tiles.length) {
                const tileStr = tiles[index];
                btn.textContent = tileStr;
                btn.dataset.tile = tileStr;
                btn.disabled = !isMyTurn || currentPhase !== 'place_tile';
                btn.classList.remove('selected');
            } else {
                btn.textContent = '-';
                btn.dataset.tile = '';
                btn.disabled = true;
                btn.classList.remove('selected');
            }
        });
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
        if (!isMyTurn || currentPhase !== 'place_tile') {
            showError('Not your turn to place a tile');
            return;
        }

        // Toggle selection
        if (selectedTile === tileStr) {
            // Already selected, deselect
            selectedTile = null;
            tile.classList.remove('selected');
            hideConfirmTile();
        } else {
            // Select this tile
            clearTileSelection();
            selectedTile = tileStr;
            tile.classList.add('selected');
            showConfirmTile(tileStr);
        }
    }

    /**
     * Clear tile selection
     */
    function clearTileSelection() {
        selectedTile = null;
        if (elements.tileRack) {
            elements.tileRack.querySelectorAll('.tile').forEach(t => {
                t.classList.remove('selected');
            });
        }
    }

    /**
     * Show tile placement confirmation
     */
    function showConfirmTile(tileStr) {
        if (!elements.actionButtons) return;

        elements.actionButtons.innerHTML = `
            <div class="confirm-tile">
                <p>Place tile <strong>${tileStr}</strong>?</p>
                <div class="button-row">
                    <button class="btn btn-primary" id="confirm-place-tile">Place Tile</button>
                    <button class="btn btn-secondary" id="cancel-place-tile">Cancel</button>
                </div>
            </div>
        `;

        document.getElementById('confirm-place-tile').addEventListener('click', () => {
            if (placeTile(tileStr)) {
                clearTileSelection();
                hideConfirmTile();
            }
        });

        document.getElementById('cancel-place-tile').addEventListener('click', () => {
            clearTileSelection();
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
     * Update money display
     * @param {number} amount - Current money amount
     */
    function updateMoney(amount) {
        if (elements.playerMoney) {
            elements.playerMoney.textContent = formatMoney(amount);
        }
        gameState.money = amount;
    }

    /**
     * Update stock portfolio display
     * @param {Object} stocks - Stock holdings { chainName: quantity }
     */
    function updateStockPortfolio(stocks) {
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];

        chains.forEach(chain => {
            const count = stocks[chain] || 0;
            const sharesEl = document.getElementById(`shares-${chain}`);
            const valueEl = document.getElementById(`value-${chain}`);

            if (sharesEl) {
                sharesEl.textContent = count;
            }

            if (valueEl) {
                // Calculate value based on chain size from game state
                const chainInfo = gameState.chains;
                let price = 0;
                if (chainInfo && chainInfo.chains) {
                    const c = chainInfo.chains.find(ch => ch.name.toLowerCase() === chain);
                    if (c) price = c.price || 0;
                }
                valueEl.textContent = formatMoney(count * price);
            }
        });

        gameState.stocks = stocks;
    }

    /**
     * Update UI based on game phase
     */
    function updatePhaseUI(phase, myTurn) {
        currentPhase = phase;
        hideAllActionPanels();

        if (!myTurn) {
            if (elements.waitingMessage) {
                elements.waitingMessage.style.display = 'block';
            }
            return;
        }

        switch (phase) {
            case 'place_tile':
                showPlaceTileUI();
                break;
            case 'buy_stocks':
                showBuyStocksUI();
                break;
            case 'merger':
                // Merger UI is triggered by specific messages
                break;
            case 'found_chain':
                // Found chain UI is triggered by choose_chain message
                break;
        }
    }

    /**
     * Hide all action panels
     */
    function hideAllActionPanels() {
        if (elements.buyStocksSection) {
            elements.buyStocksSection.classList.add('hidden');
        }
        if (elements.mergerSection) {
            elements.mergerSection.classList.add('hidden');
        }
        if (elements.chooseChainSection) {
            elements.chooseChainSection.classList.add('hidden');
        }
    }

    /**
     * Show place tile UI
     */
    function showPlaceTileUI() {
        if (elements.waitingMessage) {
            elements.waitingMessage.textContent = 'Your turn - Select a tile to place';
            elements.waitingMessage.style.display = 'block';
        }

        // Enable tiles
        if (elements.tileRack) {
            elements.tileRack.querySelectorAll('.tile').forEach(tile => {
                if (tile.dataset.tile) {
                    tile.disabled = false;
                }
            });
        }
    }

    /**
     * Show found chain UI
     */
    function showFoundChainUI(availableChains) {
        if (!elements.chooseChainSection) return;

        const choicesContainer = document.getElementById('chain-choices');
        const instruction = document.getElementById('choose-instruction');

        if (instruction) {
            instruction.textContent = 'Select a hotel chain to found:';
        }

        if (choicesContainer) {
            choicesContainer.innerHTML = '';

            availableChains.forEach(chainName => {
                const btn = document.createElement('button');
                btn.className = `chain-choice-btn chain-${chainName.toLowerCase()}`;
                btn.innerHTML = `
                    <span class="chain-dot chain-${chainName.toLowerCase()}"></span>
                    <span class="chain-name">${capitalize(chainName)}</span>
                `;
                btn.style.backgroundColor = CHAIN_COLORS[chainName.toLowerCase()] || '#666';

                btn.addEventListener('click', () => {
                    if (foundChain(chainName)) {
                        elements.chooseChainSection.classList.add('hidden');
                    }
                });

                choicesContainer.appendChild(btn);
            });
        }

        elements.chooseChainSection.classList.remove('hidden');
    }

    /**
     * Show choose survivor UI (for merger ties)
     */
    function showChooseSurvivorUI(tiedChains) {
        if (!elements.chooseChainSection) return;

        const choicesContainer = document.getElementById('chain-choices');
        const instruction = document.getElementById('choose-instruction');

        if (instruction) {
            instruction.textContent = 'Choose which chain survives the merger:';
        }

        if (choicesContainer) {
            choicesContainer.innerHTML = '';

            tiedChains.forEach(chainName => {
                const btn = document.createElement('button');
                btn.className = `chain-choice-btn chain-${chainName.toLowerCase()}`;
                btn.innerHTML = `
                    <span class="chain-dot chain-${chainName.toLowerCase()}"></span>
                    <span class="chain-name">${capitalize(chainName)}</span>
                `;
                btn.style.backgroundColor = CHAIN_COLORS[chainName.toLowerCase()] || '#666';

                btn.addEventListener('click', () => {
                    if (chooseSurvivor(chainName)) {
                        elements.chooseChainSection.classList.add('hidden');
                    }
                });

                choicesContainer.appendChild(btn);
            });
        }

        elements.chooseChainSection.classList.remove('hidden');
    }

    /**
     * Show buy stocks UI
     */
    function showBuyStocksUI() {
        if (!elements.buyStocksSection) return;

        // Reset quantities
        resetBuyStocks();

        // Update available chains and prices
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        const hotelInfo = gameState.chains || {};
        const activeChains = hotelInfo.active_chains || [];

        chains.forEach(chain => {
            const option = document.querySelector(`.buy-option[data-chain="${chain}"]`);
            if (!option) return;

            const isActive = activeChains.includes(chain);
            const chainData = hotelInfo.chains ? hotelInfo.chains.find(c => c.name.toLowerCase() === chain) : null;

            if (isActive && chainData) {
                option.classList.remove('inactive');
                option.style.display = '';

                const priceEl = document.getElementById(`price-${chain}`);
                const availableEl = document.getElementById(`available-${chain}`);

                if (priceEl) priceEl.textContent = formatMoney(chainData.price || 0);
                if (availableEl) availableEl.textContent = `${chainData.stocks_available || 25} left`;
            } else {
                option.classList.add('inactive');
                option.style.display = 'none';
            }
        });

        // Update total display
        updateBuyTotal();

        elements.buyStocksSection.classList.remove('hidden');

        if (elements.waitingMessage) {
            elements.waitingMessage.style.display = 'none';
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
        let totalSelected = getTotalSelectedStocks();

        // Get available stocks for this chain
        const hotelInfo = gameState.chains || {};
        const chainData = hotelInfo.chains ? hotelInfo.chains.find(c => c.name.toLowerCase() === chain) : null;
        const available = chainData ? (chainData.stocks_available || 25) : 25;

        if (isPlus) {
            if (totalSelected < 3 && qty < available) {
                qty++;
            }
        } else {
            if (qty > 0) {
                qty--;
            }
        }

        qtyEl.textContent = qty;
        updateBuyTotal();
    }

    /**
     * Get total selected stocks for buying
     */
    function getTotalSelectedStocks() {
        let total = 0;
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        chains.forEach(chain => {
            const qtyEl = document.getElementById(`qty-${chain}`);
            if (qtyEl) {
                total += parseInt(qtyEl.textContent) || 0;
            }
        });
        return total;
    }

    /**
     * Get purchases object for buy stocks action
     */
    function getPurchases() {
        const purchases = {};
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        chains.forEach(chain => {
            const qtyEl = document.getElementById(`qty-${chain}`);
            if (qtyEl) {
                const qty = parseInt(qtyEl.textContent) || 0;
                if (qty > 0) {
                    purchases[chain] = qty;
                }
            }
        });
        return purchases;
    }

    /**
     * Update buy stocks total display
     */
    function updateBuyTotal() {
        const totalEl = document.getElementById('buy-total');
        const stocksSelectedEl = document.getElementById('stocks-selected');
        const confirmBtn = document.getElementById('confirm-buy');

        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        const hotelInfo = gameState.chains || {};
        let total = 0;
        let count = 0;

        chains.forEach(chain => {
            const qtyEl = document.getElementById(`qty-${chain}`);
            if (qtyEl) {
                const qty = parseInt(qtyEl.textContent) || 0;
                count += qty;

                // Get price for this chain
                const chainData = hotelInfo.chains ? hotelInfo.chains.find(c => c.name.toLowerCase() === chain) : null;
                const price = chainData ? (chainData.price || 0) : 0;
                total += qty * price;
            }
        });

        if (totalEl) totalEl.textContent = formatMoney(total);
        if (stocksSelectedEl) stocksSelectedEl.textContent = `(${count}/3 stocks)`;

        // Disable confirm if can't afford
        if (confirmBtn) {
            confirmBtn.disabled = total > gameState.money;
        }
    }

    /**
     * Reset buy stocks quantities
     */
    function resetBuyStocks() {
        const chains = ['luxor', 'tower', 'american', 'festival', 'worldwide', 'continental', 'imperial'];
        chains.forEach(chain => {
            const qtyEl = document.getElementById(`qty-${chain}`);
            if (qtyEl) qtyEl.textContent = '0';
        });
        updateBuyTotal();
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

    // ==========================================================================
    // MERGER UI
    // ==========================================================================

    let mergerState = {
        defunctChain: null,
        survivingChain: null,
        totalShares: 0,
        sellPrice: 0,
        sell: 0,
        trade: 0,
        keep: 0
    };

    /**
     * Show merger disposition UI
     */
    function showMergerDispositionUI(data) {
        if (!elements.mergerSection) return;

        mergerState = {
            defunctChain: data.defunct_chain,
            survivingChain: data.surviving_chain,
            totalShares: data.shares || 0,
            sellPrice: data.sell_price || 0,
            sell: 0,
            trade: 0,
            keep: data.shares || 0
        };

        // Update UI elements
        const defunctEl = document.getElementById('defunct-chain');
        const survivingEl = document.getElementById('surviving-chain');
        const sharesEl = document.getElementById('merger-shares');
        const chainNameEl = document.getElementById('merger-chain-name');
        const sellValueEl = document.getElementById('sell-value');

        if (defunctEl) {
            defunctEl.textContent = capitalize(mergerState.defunctChain);
            defunctEl.style.color = CHAIN_COLORS[mergerState.defunctChain.toLowerCase()] || '#fff';
        }
        if (survivingEl) {
            survivingEl.textContent = capitalize(mergerState.survivingChain);
            survivingEl.style.color = CHAIN_COLORS[mergerState.survivingChain.toLowerCase()] || '#fff';
        }
        if (sharesEl) sharesEl.textContent = mergerState.totalShares;
        if (chainNameEl) chainNameEl.textContent = capitalize(mergerState.defunctChain);
        if (sellValueEl) sellValueEl.textContent = formatMoney(mergerState.sellPrice) + ' per share';

        // Reset quantities
        updateMergerDisplay();

        elements.mergerSection.classList.remove('hidden');

        if (elements.waitingMessage) {
            elements.waitingMessage.style.display = 'none';
        }
    }

    /**
     * Adjust merger quantity
     */
    function adjustMergerQuantity(type, delta) {
        const remaining = mergerState.totalShares - mergerState.sell - mergerState.trade;

        if (type === 'sell') {
            const newSell = mergerState.sell + delta;
            if (newSell >= 0 && newSell <= mergerState.totalShares - mergerState.trade) {
                mergerState.sell = newSell;
            }
        } else if (type === 'trade') {
            // Trade must be even
            const newTrade = mergerState.trade + delta;
            if (newTrade >= 0 && newTrade <= mergerState.totalShares - mergerState.sell && newTrade % 2 === 0) {
                mergerState.trade = newTrade;
            }
        }

        mergerState.keep = mergerState.totalShares - mergerState.sell - mergerState.trade;
        updateMergerDisplay();
    }

    /**
     * Update merger display
     */
    function updateMergerDisplay() {
        const sellQtyEl = document.getElementById('sell-qty');
        const tradeQtyEl = document.getElementById('trade-qty');
        const keepQtyEl = document.getElementById('keep-qty');

        if (sellQtyEl) sellQtyEl.textContent = mergerState.sell;
        if (tradeQtyEl) tradeQtyEl.textContent = mergerState.trade;
        if (keepQtyEl) keepQtyEl.textContent = mergerState.keep;
    }

    /**
     * Handle confirm merger
     */
    function handleConfirmMerger() {
        // Validate trade is even
        if (mergerState.trade % 2 !== 0) {
            showError('Trade must be an even number');
            return;
        }

        // Validate total equals holdings
        if (mergerState.sell + mergerState.trade + mergerState.keep !== mergerState.totalShares) {
            showError('Total must equal your holdings');
            return;
        }

        const disposition = {
            sell: mergerState.sell,
            trade: mergerState.trade,
            hold: mergerState.keep
        };

        if (mergerDisposition(mergerState.defunctChain, disposition)) {
            elements.mergerSection.classList.add('hidden');
        }
    }

    // ==========================================================================
    // END GAME OPTION
    // ==========================================================================

    /**
     * Show end game option
     */
    function showEndGameOption(message) {
        if (!elements.actionButtons) return;

        elements.actionButtons.innerHTML = `
            <div class="end-game-option">
                <p>${message}</p>
                <div class="button-row">
                    <button class="btn btn-warning" id="end-game-btn">End Game</button>
                    <button class="btn btn-secondary" id="continue-game-btn">Continue</button>
                </div>
            </div>
        `;

        document.getElementById('end-game-btn').addEventListener('click', () => {
            sendAction('end_game', {});
        });

        document.getElementById('continue-game-btn').addEventListener('click', () => {
            // Just continue - the normal end_turn will be called
            elements.actionButtons.innerHTML = '';
        });
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
     * Show error message
     */
    function showError(message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.textContent = message;

        document.body.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after delay
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ==========================================================================
    // PUBLIC API
    // ==========================================================================

    window.AcquirePlayer = {
        init: init,
        sendAction: sendAction,
        placeTile: placeTile,
        foundChain: foundChain,
        buyStocks: buyStocks,
        mergerDisposition: mergerDisposition,
        chooseSurvivor: chooseSurvivor,
        endTurn: endTurn,
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
