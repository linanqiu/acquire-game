/**
 * Simple state container with subscriber pattern
 * Provides a minimal, testable state management solution
 */

/**
 * Create a state store with subscriber support
 * @param {Object} initialState - Initial state object
 * @returns {Object} Store with getState, setState, subscribe methods
 */
export function createStore(initialState = {}) {
    let state = { ...initialState };
    const listeners = [];

    /**
     * Get the current state
     * @returns {Object} Current state (shallow copy)
     */
    function getState() {
        return { ...state };
    }

    /**
     * Get a specific value from state
     * @param {string} key - State key to retrieve
     * @returns {*} The value at the key
     */
    function get(key) {
        return state[key];
    }

    /**
     * Update the state with new values
     * @param {Object|function} updates - Object with updates or function(state) => updates
     */
    function setState(updates) {
        const newUpdates = typeof updates === 'function'
            ? updates(state)
            : updates;

        const prevState = state;
        state = { ...state, ...newUpdates };

        // Notify listeners
        listeners.forEach(fn => {
            try {
                fn(state, prevState);
            } catch (error) {
                console.error('State listener error:', error);
            }
        });
    }

    /**
     * Subscribe to state changes
     * @param {function} listener - Called with (newState, prevState) on changes
     * @returns {function} Unsubscribe function
     */
    function subscribe(listener) {
        listeners.push(listener);
        return () => {
            const index = listeners.indexOf(listener);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        };
    }

    /**
     * Reset state to initial values
     */
    function reset() {
        setState(initialState);
    }

    return {
        getState,
        get,
        setState,
        subscribe,
        reset
    };
}

/**
 * Create initial state for the host view
 * @returns {Object} Initial host state
 */
export function createHostState() {
    return createStore({
        board: null,
        hotel: null,
        players: {},
        currentPlayer: null,
        phase: null,
        tilesRemaining: 0,
        turnOrder: [],
        isGameStarted: false,
        connectionStatus: 'disconnected'
    });
}

/**
 * Create initial state for the player view
 * @returns {Object} Initial player state
 */
export function createPlayerState() {
    return createStore({
        tiles: [],
        money: 6000,
        stocks: {},
        chains: {},
        board: null,
        currentPlayer: null,
        phase: null,
        players: {},
        isMyTurn: false,
        selectedTile: null,
        connectionStatus: 'disconnected'
    });
}

/**
 * Create initial merger state for player view
 * @returns {Object} Initial merger state
 */
export function createMergerState() {
    return createStore({
        defunctChain: null,
        survivingChain: null,
        totalShares: 0,
        sellPrice: 0,
        sell: 0,
        trade: 0,
        keep: 0
    });
}
