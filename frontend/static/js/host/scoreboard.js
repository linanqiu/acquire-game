/**
 * Scoreboard rendering logic for the host view
 */

import { CHAIN_NAMES, CHAIN_COLORS } from '../shared/constants.js';
import { formatMoney, escapeHtml } from '../shared/formatters.js';

/**
 * Update the scoreboard with player information
 * @param {HTMLElement} tableBody - The tbody element
 * @param {Object} players - Players object keyed by player ID
 * @param {string} currentPlayerId - ID of the current player
 * @param {Array} turnOrder - Array of player IDs in turn order
 */
export function updateScoreboard(tableBody, players, currentPlayerId, turnOrder) {
    if (!tableBody || !players) return;

    tableBody.innerHTML = '';

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
        const row = createPlayerRow(playerId, player, currentPlayerId);
        tableBody.appendChild(row);
    });
}

/**
 * Create a player row element
 * @param {string} playerId - Player ID
 * @param {Object} player - Player data
 * @param {string} currentPlayerId - ID of the current player
 * @returns {HTMLTableRowElement} The row element
 */
function createPlayerRow(playerId, player, currentPlayerId) {
    const row = document.createElement('tr');
    const isCurrentTurn = playerId === currentPlayerId;

    if (isCurrentTurn) {
        row.classList.add('current-turn');
    }

    // Player name cell
    const nameCell = document.createElement('td');
    if (isCurrentTurn) {
        nameCell.innerHTML = `<strong>${escapeHtml(player.name)}</strong>`;
    } else {
        nameCell.textContent = player.name;
    }
    row.appendChild(nameCell);

    // Money cell
    const moneyCell = document.createElement('td');
    moneyCell.textContent = formatMoney(player.money || 0);
    row.appendChild(moneyCell);

    // Stock cells for each chain
    const stocks = player.stocks || {};
    CHAIN_NAMES.forEach(chain => {
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

    return row;
}

/**
 * Update the scoreboard for lobby (pre-game) state
 * @param {HTMLElement} tableBody - The tbody element
 * @param {Array} players - Array of player objects
 */
export function updateLobbyScoreboard(tableBody, players) {
    if (!tableBody) return;

    tableBody.innerHTML = '';

    players.forEach(player => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(player.name)}${player.is_bot ? ' (Bot)' : ''}</td>
            <td>$6,000</td>
            <td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
        `;
        tableBody.appendChild(row);
    });
}

/**
 * Update the current player display
 * @param {HTMLElement} element - The current player element
 * @param {Object} players - Players object
 * @param {string} currentPlayerId - ID of the current player
 * @param {string} phase - Current game phase
 * @param {Object} phaseDescriptions - Phase to description mapping
 */
export function updateCurrentPlayer(element, players, currentPlayerId, phase, phaseDescriptions) {
    if (!element) return;

    if (currentPlayerId && players && players[currentPlayerId]) {
        const playerName = players[currentPlayerId].name;
        const phaseText = phaseDescriptions[phase] || phase || 'Waiting';
        element.textContent = `${playerName} - ${phaseText}`;
        element.classList.remove('winner');
    } else {
        element.textContent = 'Waiting...';
    }
}

/**
 * Display game over state
 * @param {HTMLElement} element - The current player element
 * @param {string} winnerName - Name of the winner
 */
export function showWinner(element, winnerName) {
    if (!element) return;

    element.textContent = `Winner: ${winnerName}!`;
    element.classList.add('winner');
}
