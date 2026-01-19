/**
 * Lobby controls for the host view
 */

import { CONFIG } from '../shared/constants.js';

/**
 * Update lobby control states based on player count
 * @param {Object} elements - DOM elements {lobbyControls, startGameBtn, addBotBtn, playerCount}
 * @param {Array} players - Array of player objects
 * @param {boolean} canStart - Whether game can be started
 */
export function updateLobbyControls(elements, players, canStart) {
    const { lobbyControls, startGameBtn, addBotBtn, playerCount } = elements;

    // Update player count
    if (playerCount) {
        playerCount.textContent = players.length;
    }

    // Update start button
    if (startGameBtn) {
        startGameBtn.disabled = !canStart;
    }

    // Update add bot button (disabled if room is full)
    if (addBotBtn) {
        addBotBtn.disabled = players.length >= CONFIG.maxPlayers;
    }

    // Show lobby controls
    if (lobbyControls) {
        lobbyControls.style.display = 'block';
    }
}

/**
 * Hide lobby controls (when game starts)
 * @param {HTMLElement} lobbyControls - The lobby controls element
 */
export function hideLobbyControls(lobbyControls) {
    if (lobbyControls) {
        lobbyControls.style.display = 'none';
    }
}

/**
 * Update waiting message
 * @param {HTMLElement} element - The current player element
 * @param {number} playerCount - Number of players joined
 */
export function updateWaitingMessage(element, playerCount) {
    if (element) {
        element.textContent = `Waiting for players... (${playerCount} joined)`;
    }
}
