/**
 * Stock portfolio display for the player view
 */

import { CHAIN_NAMES } from '../shared/constants.js';
import { formatMoney } from '../shared/formatters.js';

/**
 * Update money display
 * @param {HTMLElement} moneyElement - The money display element
 * @param {number} amount - Current money amount
 */
export function updateMoney(moneyElement, amount) {
    if (moneyElement) {
        moneyElement.textContent = formatMoney(amount);
    }
}

/**
 * Update stock portfolio display
 * @param {Object} stocks - Stock holdings { chainName: quantity }
 * @param {Object} chainInfo - Hotel chain info from game state
 */
export function updateStockPortfolio(stocks, chainInfo) {
    CHAIN_NAMES.forEach(chain => {
        const count = stocks[chain] || 0;
        const sharesEl = document.getElementById(`shares-${chain}`);
        const valueEl = document.getElementById(`value-${chain}`);

        if (sharesEl) {
            sharesEl.textContent = count;
        }

        if (valueEl) {
            // Calculate value based on chain size from game state
            let price = 0;
            if (chainInfo && chainInfo.chains) {
                const c = chainInfo.chains.find(ch => ch.name.toLowerCase() === chain);
                if (c) price = c.price || 0;
            }
            valueEl.textContent = formatMoney(count * price);
        }
    });
}

/**
 * Get the price of a chain from hotel info
 * @param {string} chainName - The chain name
 * @param {Object} chainInfo - Hotel chain info from game state
 * @returns {number} The chain price
 */
export function getChainPrice(chainName, chainInfo) {
    if (!chainInfo || !chainInfo.chains) return 0;
    const chain = chainInfo.chains.find(c => c.name.toLowerCase() === chainName.toLowerCase());
    return chain ? (chain.price || 0) : 0;
}

/**
 * Get available stocks for a chain
 * @param {string} chainName - The chain name
 * @param {Object} chainInfo - Hotel chain info from game state
 * @returns {number} Number of available stocks
 */
export function getAvailableStocks(chainName, chainInfo) {
    if (!chainInfo || !chainInfo.chains) return 25;
    const chain = chainInfo.chains.find(c => c.name.toLowerCase() === chainName.toLowerCase());
    return chain ? (chain.stocks_available || 25) : 25;
}
