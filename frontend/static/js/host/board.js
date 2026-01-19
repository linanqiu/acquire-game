/**
 * Board rendering logic for the host view
 */

import { CHAIN_COLORS, CHAIN_NAMES, BOARD, CONFIG } from '../shared/constants.js';
import { parseTile } from '../shared/formatters.js';

/**
 * Update the game board display
 * @param {Object} boardData - Board data from server with cells object
 */
export function updateBoard(boardData) {
    if (!boardData || !boardData.cells) return;

    const cells = boardData.cells;

    // First, reset all cells to empty state
    for (let col = BOARD.minColumn; col <= BOARD.maxColumn; col++) {
        for (const row of BOARD.rows) {
            const cellId = `cell-${col}-${row}`;
            const cellElement = document.getElementById(cellId);
            if (cellElement) {
                resetCell(cellElement);
            }
        }
    }

    // Apply cell states from server data
    // cells is an object with keys like "1A", "2B" and values with state/chain
    for (const [tileKey, cellData] of Object.entries(cells)) {
        const parsed = parseTile(tileKey);
        if (!parsed) continue;

        const { col, row } = parsed;
        const cellId = `cell-${col}-${row}`;
        const cellElement = document.getElementById(cellId);

        if (cellElement) {
            applyCellState(cellElement, cellData);
        }
    }
}

/**
 * Reset a cell to empty state
 * @param {HTMLElement} cellElement - The cell element
 */
function resetCell(cellElement) {
    // Remove all chain classes
    cellElement.classList.remove('played', ...CHAIN_NAMES);
    cellElement.style.backgroundColor = '';
    cellElement.style.color = '';
}

/**
 * Apply cell state to an element
 * @param {HTMLElement} cellElement - The cell element
 * @param {Object} cellData - Cell data with state and chain properties
 */
function applyCellState(cellElement, cellData) {
    if (cellData.chain) {
        // Cell belongs to a chain
        const chainName = cellData.chain.toLowerCase();
        cellElement.classList.add(chainName);
        cellElement.style.backgroundColor = CHAIN_COLORS[chainName] || '#666';
        cellElement.style.color = '#000';
    } else if (cellData.state === 'played') {
        // Cell has a tile but no chain yet
        cellElement.classList.add('played');
        cellElement.style.backgroundColor = '#888';
        cellElement.style.color = '#fff';
    }
}

/**
 * Update chain information display (sizes and status)
 * @param {Object} hotelData - Hotel data from server
 */
export function updateChainInfo(hotelData) {
    if (!hotelData) return;

    const chains = hotelData.chains || [];
    const activeChains = hotelData.active_chains || [];

    CHAIN_NAMES.forEach(chainName => {
        const sizeEl = document.getElementById(`size-${chainName}`);
        const chainItem = document.querySelector(`.chain-item[data-chain="${chainName}"]`);

        // Find chain data if exists
        const chainData = chains.find(c => c.name && c.name.toLowerCase() === chainName);
        const isActive = activeChains.includes(chainName);

        // Update size display
        if (sizeEl) {
            if (isActive && chainData) {
                sizeEl.textContent = chainData.size || 0;
            } else {
                sizeEl.textContent = '0';
            }
        }

        // Update chain item styling
        if (chainItem) {
            if (isActive) {
                chainItem.classList.add('active');
                chainItem.classList.remove('inactive');

                // Check if safe (11+ tiles)
                if (chainData && chainData.size >= CONFIG.safeChainSize) {
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
 * Get a cell element by tile coordinates
 * @param {number} col - Column number
 * @param {string} row - Row letter
 * @returns {HTMLElement|null} The cell element
 */
export function getCell(col, row) {
    return document.getElementById(`cell-${col}-${row}`);
}

/**
 * Highlight a cell (for previewing tile placement, etc.)
 * @param {number} col - Column number
 * @param {string} row - Row letter
 * @param {boolean} highlight - Whether to highlight or unhighlight
 */
export function highlightCell(col, row, highlight = true) {
    const cell = getCell(col, row);
    if (cell) {
        if (highlight) {
            cell.classList.add('highlight');
        } else {
            cell.classList.remove('highlight');
        }
    }
}
