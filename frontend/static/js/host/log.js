/**
 * Game log functionality for the host view
 */

import { CONFIG } from '../shared/constants.js';
import { escapeHtml, formatTime } from '../shared/formatters.js';

/**
 * Add an entry to the game log
 * @param {HTMLElement} logContainer - The log container element
 * @param {string} message - The message to log
 * @param {string} [type='info'] - The log type (info, error, turn, winner, important)
 */
export function addLogEntry(logContainer, message, type = 'info') {
    if (!logContainer) return;

    const entry = document.createElement('p');
    entry.className = `log-entry log-${type}`;

    const timestamp = formatTime();
    entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${escapeHtml(message)}`;

    // Add to beginning of log
    if (logContainer.firstChild) {
        logContainer.insertBefore(entry, logContainer.firstChild);
    } else {
        logContainer.appendChild(entry);
    }

    // Limit log entries
    while (logContainer.children.length > CONFIG.maxLogEntries) {
        logContainer.removeChild(logContainer.lastChild);
    }
}

/**
 * Clear the game log
 * @param {HTMLElement} logContainer - The log container element
 */
export function clearLog(logContainer) {
    if (logContainer) {
        logContainer.innerHTML = '';
    }
}

/**
 * Add a turn change entry
 * @param {HTMLElement} logContainer - The log container element
 * @param {string} playerName - Name of the player whose turn it is
 * @param {string} phaseDescription - Description of the phase
 */
export function logTurnChange(logContainer, playerName, phaseDescription) {
    addLogEntry(logContainer, `${playerName}'s turn - ${phaseDescription}`, 'turn');
}

/**
 * Add a phase change entry
 * @param {HTMLElement} logContainer - The log container element
 * @param {string} phaseDescription - Description of the phase
 */
export function logPhaseChange(logContainer, phaseDescription) {
    addLogEntry(logContainer, `Phase: ${phaseDescription}`);
}

/**
 * Log game over with final standings
 * @param {HTMLElement} logContainer - The log container element
 * @param {Object} scores - Scores object keyed by player ID
 * @param {string} winnerId - ID of the winning player
 * @param {function} formatMoney - Money formatting function
 */
export function logGameOver(logContainer, scores, winnerId, formatMoney) {
    // Sort players by score
    const sortedPlayers = Object.entries(scores)
        .sort((a, b) => b[1].money - a[1].money);

    addLogEntry(logContainer, '=== GAME OVER ===', 'important');

    sortedPlayers.forEach(([pid, info], index) => {
        const isWinner = pid === winnerId;
        addLogEntry(
            logContainer,
            `${index + 1}. ${info.name}: ${formatMoney(info.money)}${isWinner ? ' - WINNER!' : ''}`,
            isWinner ? 'winner' : 'info'
        );
    });
}
