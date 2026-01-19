/**
 * Shared formatting utilities for the Acquire game
 * All functions are pure and testable
 */

/**
 * Format a money amount with dollar sign and commas
 * @param {number} amount - The amount to format
 * @returns {string} Formatted money string like "$1,234"
 */
export function formatMoney(amount) {
    return '$' + Number(amount || 0).toLocaleString();
}

/**
 * Capitalize the first letter of a string
 * @param {string} str - The string to capitalize
 * @returns {string} Capitalized string
 */
export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - The text to escape
 * @returns {string} HTML-escaped text
 */
export function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Parse a tile key string like "1A" or "12I" into column and row
 * @param {string} tileKey - The tile key to parse
 * @returns {{col: number, row: string}|null} Parsed tile or null if invalid
 */
export function parseTile(tileKey) {
    if (!tileKey || typeof tileKey !== 'string') return null;
    const match = tileKey.match(/^(\d+)([A-I])$/);
    if (!match) return null;
    return {
        col: parseInt(match[1], 10),
        row: match[2]
    };
}

/**
 * Format a tile object or coordinates into a tile key string
 * @param {number} col - Column number (1-12)
 * @param {string} row - Row letter (A-I)
 * @returns {string} Tile key like "1A" or "12I"
 */
export function formatTile(col, row) {
    return `${col}${row}`;
}

/**
 * Format a timestamp for display in the game log
 * @param {Date} [date=new Date()] - The date to format
 * @returns {string} Formatted time string like "14:30:45"
 */
export function formatTime(date = new Date()) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

/**
 * Get a CSS class name for a chain
 * @param {string} chainName - The chain name
 * @returns {string} CSS class name like "chain-luxor"
 */
export function getChainClass(chainName) {
    if (!chainName) return '';
    return `chain-${chainName.toLowerCase()}`;
}

/**
 * Format a number with an ordinal suffix (1st, 2nd, 3rd, etc.)
 * @param {number} n - The number to format
 * @returns {string} Number with ordinal suffix
 */
export function formatOrdinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Pluralize a word based on count
 * @param {number} count - The count
 * @param {string} singular - Singular form
 * @param {string} [plural] - Plural form (defaults to singular + 's')
 * @returns {string} The appropriate form
 */
export function pluralize(count, singular, plural) {
    return count === 1 ? singular : (plural || singular + 's');
}
