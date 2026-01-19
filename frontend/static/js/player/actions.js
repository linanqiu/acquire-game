/**
 * Action buttons and turn indicator for the player view
 */

import { PHASES } from '../shared/constants.js';

/**
 * Update turn indicator and show appropriate message
 * @param {HTMLElement} waitingMessage - The waiting message element
 * @param {boolean} isMyTurn - Whether it's this player's turn
 * @param {string} phase - Current game phase
 */
export function updateTurnIndicator(waitingMessage, isMyTurn, phase) {
    if (!waitingMessage) return;

    if (isMyTurn) {
        const phaseMessages = {
            [PHASES.PLACE_TILE]: 'Your turn - Place a tile',
            [PHASES.FOUND_CHAIN]: 'Your turn - Found a chain',
            [PHASES.BUY_STOCKS]: 'Your turn - Buy stocks',
            [PHASES.MERGER]: 'Your turn - Handle merger'
        };
        waitingMessage.textContent = phaseMessages[phase] || 'Your turn';
        waitingMessage.classList.add('your-turn');
    } else {
        waitingMessage.textContent = 'Waiting for other player...';
        waitingMessage.classList.remove('your-turn');
    }
}

/**
 * Update connection status indicator
 * @param {HTMLElement} statusContainer - The status container element
 * @param {string} status - Connection status: 'connected', 'disconnected', 'connecting'
 */
export function updateConnectionStatus(statusContainer, status) {
    if (!statusContainer) return;

    const indicator = statusContainer.querySelector('.status-indicator');
    const text = statusContainer.querySelector('.status-text');

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
 * Show lobby waiting message
 * @param {HTMLElement} waitingMessage - The waiting message element
 * @param {number} playerCount - Number of players in lobby
 */
export function showLobbyWaiting(waitingMessage, playerCount) {
    if (waitingMessage) {
        waitingMessage.textContent = `Waiting for game to start... (${playerCount} players)`;
        waitingMessage.style.display = 'block';
    }
}

/**
 * Show place tile UI
 * @param {HTMLElement} waitingMessage - The waiting message element
 */
export function showPlaceTileMessage(waitingMessage) {
    if (waitingMessage) {
        waitingMessage.textContent = 'Your turn - Select a tile to place';
        waitingMessage.style.display = 'block';
    }
}

/**
 * Create end game option HTML
 * @param {string} message - The end game message
 * @returns {string} HTML string
 */
export function createEndGameOptionHtml(message) {
    return `
        <div class="end-game-option">
            <p>${message}</p>
            <div class="button-row">
                <button class="btn btn-warning" id="end-game-btn">End Game</button>
                <button class="btn btn-secondary" id="continue-game-btn">Continue</button>
            </div>
        </div>
    `;
}

/**
 * Show error toast notification
 * @param {string} message - Error message to display
 */
export function showError(message) {
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
