/**
 * Modal UI components for chain selection and merger
 */

import { CHAIN_COLORS, CHAIN_NAMES } from '../shared/constants.js';
import { capitalize, formatMoney } from '../shared/formatters.js';

/**
 * Show the found chain UI
 * @param {HTMLElement} chooseChainSection - The choose chain section element
 * @param {Array} availableChains - Array of available chain names
 * @param {function} onSelect - Callback when chain is selected
 */
export function showFoundChainUI(chooseChainSection, availableChains, onSelect) {
    if (!chooseChainSection) return;

    const choicesContainer = document.getElementById('chain-choices');
    const instruction = document.getElementById('choose-instruction');

    if (instruction) {
        instruction.textContent = 'Select a hotel chain to found:';
    }

    if (choicesContainer) {
        choicesContainer.innerHTML = '';

        availableChains.forEach(chainName => {
            const btn = createChainButton(chainName, () => {
                if (onSelect(chainName)) {
                    chooseChainSection.classList.add('hidden');
                }
            });
            choicesContainer.appendChild(btn);
        });
    }

    chooseChainSection.classList.remove('hidden');
}

/**
 * Show the choose survivor UI (for merger ties)
 * @param {HTMLElement} chooseChainSection - The choose chain section element
 * @param {Array} tiedChains - Array of tied chain names
 * @param {function} onSelect - Callback when chain is selected
 */
export function showChooseSurvivorUI(chooseChainSection, tiedChains, onSelect) {
    if (!chooseChainSection) return;

    const choicesContainer = document.getElementById('chain-choices');
    const instruction = document.getElementById('choose-instruction');

    if (instruction) {
        instruction.textContent = 'Choose which chain survives the merger:';
    }

    if (choicesContainer) {
        choicesContainer.innerHTML = '';

        tiedChains.forEach(chainName => {
            const btn = createChainButton(chainName, () => {
                if (onSelect(chainName)) {
                    chooseChainSection.classList.add('hidden');
                }
            });
            choicesContainer.appendChild(btn);
        });
    }

    chooseChainSection.classList.remove('hidden');
}

/**
 * Create a chain selection button
 * @param {string} chainName - The chain name
 * @param {function} onClick - Click handler
 * @returns {HTMLButtonElement} The button element
 */
function createChainButton(chainName, onClick) {
    const btn = document.createElement('button');
    const lowerName = chainName.toLowerCase();
    btn.className = `chain-choice-btn chain-${lowerName}`;
    btn.innerHTML = `
        <span class="chain-dot chain-${lowerName}"></span>
        <span class="chain-name">${capitalize(chainName)}</span>
    `;
    btn.style.backgroundColor = CHAIN_COLORS[lowerName] || '#666';
    btn.addEventListener('click', onClick);
    return btn;
}

/**
 * Show the buy stocks UI
 * @param {HTMLElement} buyStocksSection - The buy stocks section element
 * @param {HTMLElement} waitingMessage - The waiting message element
 * @param {Object} chainInfo - Hotel chain info from game state
 * @param {number} playerMoney - Player's current money
 */
export function showBuyStocksUI(buyStocksSection, waitingMessage, chainInfo, playerMoney) {
    if (!buyStocksSection) return;

    // Reset quantities
    resetBuyStocks();

    // Update available chains and prices
    const hotelInfo = chainInfo || {};
    const activeChains = hotelInfo.active_chains || [];

    CHAIN_NAMES.forEach(chain => {
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
    updateBuyTotal(chainInfo, playerMoney);

    buyStocksSection.classList.remove('hidden');

    if (waitingMessage) {
        waitingMessage.style.display = 'none';
    }
}

/**
 * Reset buy stocks quantities
 */
export function resetBuyStocks() {
    CHAIN_NAMES.forEach(chain => {
        const qtyEl = document.getElementById(`qty-${chain}`);
        if (qtyEl) qtyEl.textContent = '0';
    });
}

/**
 * Get total selected stocks for buying
 * @returns {number} Total selected stocks
 */
export function getTotalSelectedStocks() {
    let total = 0;
    CHAIN_NAMES.forEach(chain => {
        const qtyEl = document.getElementById(`qty-${chain}`);
        if (qtyEl) {
            total += parseInt(qtyEl.textContent) || 0;
        }
    });
    return total;
}

/**
 * Get purchases object for buy stocks action
 * @returns {Object} Purchases object { chainName: quantity }
 */
export function getPurchases() {
    const purchases = {};
    CHAIN_NAMES.forEach(chain => {
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
 * @param {Object} chainInfo - Hotel chain info from game state
 * @param {number} playerMoney - Player's current money
 */
export function updateBuyTotal(chainInfo, playerMoney) {
    const totalEl = document.getElementById('buy-total');
    const stocksSelectedEl = document.getElementById('stocks-selected');
    const confirmBtn = document.getElementById('confirm-buy');

    const hotelInfo = chainInfo || {};
    let total = 0;
    let count = 0;

    CHAIN_NAMES.forEach(chain => {
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
        confirmBtn.disabled = total > playerMoney;
    }
}

/**
 * Show merger disposition UI
 * @param {HTMLElement} mergerSection - The merger section element
 * @param {HTMLElement} waitingMessage - The waiting message element
 * @param {Object} data - Merger data from server
 * @param {Object} mergerState - Merger state object to update
 */
export function showMergerDispositionUI(mergerSection, waitingMessage, data, mergerState) {
    if (!mergerSection) return;

    // Initialize merger state
    mergerState.defunctChain = data.defunct_chain;
    mergerState.survivingChain = data.surviving_chain;
    mergerState.totalShares = data.shares || 0;
    mergerState.sellPrice = data.sell_price || 0;
    mergerState.sell = 0;
    mergerState.trade = 0;
    mergerState.keep = data.shares || 0;

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

    // Update display
    updateMergerDisplay(mergerState);

    mergerSection.classList.remove('hidden');

    if (waitingMessage) {
        waitingMessage.style.display = 'none';
    }
}

/**
 * Adjust merger quantity
 * @param {Object} mergerState - Merger state object
 * @param {string} type - 'sell' or 'trade'
 * @param {number} delta - Amount to change
 */
export function adjustMergerQuantity(mergerState, type, delta) {
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
    updateMergerDisplay(mergerState);
}

/**
 * Update merger display
 * @param {Object} mergerState - Merger state object
 */
export function updateMergerDisplay(mergerState) {
    const sellQtyEl = document.getElementById('sell-qty');
    const tradeQtyEl = document.getElementById('trade-qty');
    const keepQtyEl = document.getElementById('keep-qty');

    if (sellQtyEl) sellQtyEl.textContent = mergerState.sell;
    if (tradeQtyEl) tradeQtyEl.textContent = mergerState.trade;
    if (keepQtyEl) keepQtyEl.textContent = mergerState.keep;
}

/**
 * Validate merger disposition
 * @param {Object} mergerState - Merger state object
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export function validateMergerDisposition(mergerState) {
    if (mergerState.trade % 2 !== 0) {
        return { valid: false, error: 'Trade must be an even number' };
    }

    if (mergerState.sell + mergerState.trade + mergerState.keep !== mergerState.totalShares) {
        return { valid: false, error: 'Total must equal your holdings' };
    }

    return { valid: true };
}

/**
 * Get merger disposition for action
 * @param {Object} mergerState - Merger state object
 * @returns {Object} Disposition object { sell, trade, hold }
 */
export function getMergerDisposition(mergerState) {
    return {
        sell: mergerState.sell,
        trade: mergerState.trade,
        hold: mergerState.keep
    };
}

/**
 * Hide all action panels
 * @param {Object} elements - Panel elements { buyStocksSection, mergerSection, chooseChainSection }
 */
export function hideAllActionPanels(elements) {
    const { buyStocksSection, mergerSection, chooseChainSection } = elements;

    if (buyStocksSection) buyStocksSection.classList.add('hidden');
    if (mergerSection) mergerSection.classList.add('hidden');
    if (chooseChainSection) chooseChainSection.classList.add('hidden');
}
