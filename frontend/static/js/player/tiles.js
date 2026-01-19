/**
 * Tile rack logic for the player view
 */

import { PHASES } from '../shared/constants.js';

/**
 * Update the tile rack display
 * @param {HTMLElement} tileRack - The tile rack container element
 * @param {Array} tiles - Array of tile strings like ["1A", "5C", "12I"]
 * @param {boolean} isMyTurn - Whether it's this player's turn
 * @param {string} currentPhase - Current game phase
 */
export function updateTileRack(tileRack, tiles, isMyTurn, currentPhase) {
    if (!tileRack) {
        console.warn('updateTileRack: tileRack element is null');
        return;
    }

    console.log('updateTileRack called:', { tiles, isMyTurn, currentPhase });

    const tileButtons = tileRack.querySelectorAll('.tile');
    const canPlace = isMyTurn && currentPhase === PHASES.PLACE_TILE;

    console.log(`Found ${tileButtons.length} tile buttons, canPlace=${canPlace}`);

    tileButtons.forEach((btn, index) => {
        if (index < tiles.length) {
            const tileStr = tiles[index];
            btn.textContent = tileStr;
            btn.dataset.tile = tileStr;
            btn.disabled = !canPlace;
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
 * Clear tile selection
 * @param {HTMLElement} tileRack - The tile rack container element
 */
export function clearTileSelection(tileRack) {
    if (!tileRack) return;
    tileRack.querySelectorAll('.tile').forEach(t => {
        t.classList.remove('selected');
    });
}

/**
 * Select a specific tile
 * @param {HTMLElement} tileElement - The tile button element
 */
export function selectTile(tileElement) {
    if (!tileElement) return;
    tileElement.classList.add('selected');
}

/**
 * Enable tiles for selection
 * @param {HTMLElement} tileRack - The tile rack container element
 */
export function enableTiles(tileRack) {
    if (!tileRack) return;
    tileRack.querySelectorAll('.tile').forEach(tile => {
        if (tile.dataset.tile) {
            tile.disabled = false;
        }
    });
}

/**
 * Disable all tiles
 * @param {HTMLElement} tileRack - The tile rack container element
 */
export function disableTiles(tileRack) {
    if (!tileRack) return;
    tileRack.querySelectorAll('.tile').forEach(tile => {
        tile.disabled = true;
    });
}

/**
 * Create tile placement confirmation HTML
 * @param {string} tileStr - The tile string
 * @returns {string} HTML string for confirmation dialog
 */
export function createTileConfirmHtml(tileStr) {
    return `
        <div class="confirm-tile">
            <p>Place tile <strong>${tileStr}</strong>?</p>
            <div class="button-row">
                <button class="btn btn-primary" id="confirm-place-tile">Place Tile</button>
                <button class="btn btn-secondary" id="cancel-place-tile">Cancel</button>
            </div>
        </div>
    `;
}
