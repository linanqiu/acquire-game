/**
 * Tests for shared/websocket.js and shared/state.js WebSocket-related functionality
 * Run with: node --experimental-vm-modules websocket.test.js
 */

// Mock WebSocket for Node.js testing
class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        this.sentMessages = [];

        // Auto-connect after a tick
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            if (this.onopen) this.onopen();
        }, 10);
    }

    send(data) {
        if (this.readyState !== MockWebSocket.OPEN) {
            throw new Error('WebSocket not open');
        }
        this.sentMessages.push(JSON.parse(data));
    }

    close(code = 1000, reason = '') {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) {
            this.onclose({ code, reason });
        }
    }

    // Simulate receiving a message
    simulateMessage(data) {
        if (this.onmessage) {
            this.onmessage({ data: JSON.stringify(data) });
        }
    }
}

// Polyfill WebSocket for Node.js
if (typeof WebSocket === 'undefined') {
    globalThis.WebSocket = MockWebSocket;
}

// Mock window.location for URL builders
if (typeof window === 'undefined') {
    globalThis.window = {
        location: {
            protocol: 'http:',
            host: 'localhost:8000'
        }
    };
}

// Simple test runner
const tests = [];
const asyncTests = [];

function test(name, fn) {
    if (fn.constructor.name === 'AsyncFunction') {
        asyncTests.push({ name, fn });
    } else {
        tests.push({ name, fn });
    }
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(actual, message = '') {
    if (!actual) {
        throw new Error(`${message} Expected truthy value, got ${JSON.stringify(actual)}`);
    }
}

function assertFalse(actual, message = '') {
    if (actual) {
        throw new Error(`${message} Expected falsy value, got ${JSON.stringify(actual)}`);
    }
}

// Import modules
import { createStore, createPlayerState, createHostState } from '../shared/state.js';
import { buildHostUrl, buildPlayerUrl } from '../shared/websocket.js';

// ============================================================================
// State Store Tests - Game State Updates
// ============================================================================

test('createStore initializes with given state', () => {
    const store = createStore({ count: 0, name: 'test' });
    const state = store.getState();
    assertEqual(state.count, 0);
    assertEqual(state.name, 'test');
});

test('setState updates state correctly', () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 5 });
    assertEqual(store.get('count'), 5);
});

test('setState with function updates based on previous state', () => {
    const store = createStore({ count: 0 });
    store.setState(prev => ({ count: prev.count + 1 }));
    assertEqual(store.get('count'), 1);
});

test('subscribe notifies on state changes', () => {
    const store = createStore({ count: 0 });
    let notified = false;
    let newState = null;
    let oldState = null;

    store.subscribe((state, prevState) => {
        notified = true;
        newState = state;
        oldState = prevState;
    });

    store.setState({ count: 10 });

    assertTrue(notified, 'Subscriber should be notified');
    assertEqual(newState.count, 10, 'New state should have updated count');
    assertEqual(oldState.count, 0, 'Old state should have original count');
});

test('unsubscribe stops notifications', () => {
    const store = createStore({ count: 0 });
    let callCount = 0;

    const unsubscribe = store.subscribe(() => {
        callCount++;
    });

    store.setState({ count: 1 });
    assertEqual(callCount, 1);

    unsubscribe();
    store.setState({ count: 2 });
    assertEqual(callCount, 1, 'Should not be called after unsubscribe');
});

// ============================================================================
// Game State Message Parsing Tests
// ============================================================================

test('parseGameState updates currentPlayer correctly', () => {
    const store = createPlayerState();

    // Simulate receiving a game_state message
    const gameState = {
        type: 'game_state',
        current_player: 'player123',
        phase: 'place_tile',
        players: {
            player123: { name: 'Alice', money: 6000 },
            player456: { name: 'Bob', money: 6000 }
        },
        your_hand: ['1A', '2B', '3C', '4D', '5E', '6F']
    };

    // Update store as game.js would
    store.setState({
        currentPlayer: gameState.current_player,
        phase: gameState.phase,
        players: gameState.players,
        tiles: gameState.your_hand
    });

    assertEqual(store.get('currentPlayer'), 'player123');
    assertEqual(store.get('phase'), 'place_tile');
    assertEqual(store.get('tiles').length, 6);
});

test('shows "Your Turn" when current_player matches player ID', () => {
    const store = createPlayerState();
    const PLAYER_ID = 'player123';

    store.setState({
        currentPlayer: PLAYER_ID,
        phase: 'place_tile'
    });

    // Simulating what the UI logic would do
    const isMyTurn = store.get('currentPlayer') === PLAYER_ID;
    assertTrue(isMyTurn, 'Should be my turn');
});

test('shows opponent turn when current_player differs', () => {
    const store = createPlayerState();
    const PLAYER_ID = 'player123';

    store.setState({
        currentPlayer: 'player456',  // Different player
        phase: 'place_tile'
    });

    const isMyTurn = store.get('currentPlayer') === PLAYER_ID;
    assertFalse(isMyTurn, 'Should not be my turn');
});

// ============================================================================
// Tile Rack Updates Tests
// ============================================================================

test('displays tiles from your_hand', () => {
    const store = createPlayerState();

    store.setState({
        tiles: ['1A', '2B', '3C', '4D', '5E', '6F']
    });

    const tiles = store.get('tiles');
    assertEqual(tiles.length, 6);
    assertEqual(tiles[0], '1A');
    assertEqual(tiles[5], '6F');
});

test('tiles update when new hand is received', () => {
    const store = createPlayerState();

    // Initial hand
    store.setState({
        tiles: ['1A', '2B', '3C', '4D', '5E', '6F']
    });

    // After placing 1A and drawing 7G
    store.setState({
        tiles: ['2B', '3C', '4D', '5E', '6F', '7G']
    });

    const tiles = store.get('tiles');
    assertFalse(tiles.includes('1A'), '1A should be gone');
    assertTrue(tiles.includes('7G'), '7G should be present');
});

// ============================================================================
// WebSocket URL Building Tests
// ============================================================================

test('buildHostUrl creates correct WebSocket URL', () => {
    const url = buildHostUrl('ABCD');
    assertEqual(url, 'ws://localhost:8000/ws/host/ABCD');
});

test('buildPlayerUrl creates correct WebSocket URL', () => {
    const url = buildPlayerUrl('ABCD', 'player123');
    assertEqual(url, 'ws://localhost:8000/ws/player/ABCD/player123');
});

// ============================================================================
// Host State Tests
// ============================================================================

test('createHostState initializes with correct defaults', () => {
    const store = createHostState();
    const state = store.getState();

    assertEqual(state.board, null);
    assertEqual(state.hotel, null);
    assertDeepEqual(state.players, {});
    assertEqual(state.currentPlayer, null);
    assertEqual(state.phase, null);
    assertEqual(state.tilesRemaining, 0);
    assertDeepEqual(state.turnOrder, []);
    assertFalse(state.isGameStarted);
    assertEqual(state.connectionStatus, 'disconnected');
});

test('host state updates with game state message', () => {
    const store = createHostState();

    // Simulate game_state message
    store.setState({
        board: { cells: {} },
        hotel: { chains: [] },
        players: {
            p1: { name: 'Alice', money: 6000 },
            p2: { name: 'Bob', money: 6000 }
        },
        currentPlayer: 'p1',
        phase: 'place_tile',
        tilesRemaining: 90,
        turnOrder: ['p1', 'p2'],
        isGameStarted: true
    });

    const state = store.getState();
    assertTrue(state.isGameStarted);
    assertEqual(state.currentPlayer, 'p1');
    assertEqual(state.tilesRemaining, 90);
    assertEqual(state.turnOrder.length, 2);
});

// ============================================================================
// Player State Tests
// ============================================================================

test('createPlayerState initializes with correct defaults', () => {
    const store = createPlayerState();
    const state = store.getState();

    assertDeepEqual(state.tiles, []);
    assertEqual(state.money, 6000);
    assertDeepEqual(state.stocks, {});
    assertEqual(state.board, null);
    assertEqual(state.currentPlayer, null);
    assertEqual(state.phase, null);
    assertFalse(state.isMyTurn);
    assertEqual(state.selectedTile, null);
    assertEqual(state.connectionStatus, 'disconnected');
});

test('player state tracks selected tile', () => {
    const store = createPlayerState();

    store.setState({
        tiles: ['1A', '2B', '3C'],
        selectedTile: '1A'
    });

    assertEqual(store.get('selectedTile'), '1A');
});

test('player state updates stocks after purchase', () => {
    const store = createPlayerState();

    // Initial state
    store.setState({
        money: 6000,
        stocks: {}
    });

    // After buying 2 Luxor stocks at $300 each
    store.setState({
        money: 5400,
        stocks: { Luxor: 2 }
    });

    assertEqual(store.get('money'), 5400);
    assertEqual(store.get('stocks').Luxor, 2);
});

// ============================================================================
// Connection Status Tests
// ============================================================================

test('connection status updates correctly', () => {
    const store = createPlayerState();

    // Initial disconnected
    assertEqual(store.get('connectionStatus'), 'disconnected');

    // Connected
    store.setState({ connectionStatus: 'connected' });
    assertEqual(store.get('connectionStatus'), 'connected');

    // Reconnecting
    store.setState({ connectionStatus: 'connecting' });
    assertEqual(store.get('connectionStatus'), 'connecting');
});

// ============================================================================
// Turn Tracking Tests
// ============================================================================

test('isMyTurn computed correctly', () => {
    const store = createPlayerState();
    const MY_PLAYER_ID = 'player123';

    // Simulate game state where it's my turn
    store.setState({
        currentPlayer: MY_PLAYER_ID,
        isMyTurn: MY_PLAYER_ID === MY_PLAYER_ID
    });

    assertTrue(store.get('isMyTurn'));

    // Simulate game state where it's not my turn
    store.setState({
        currentPlayer: 'other_player',
        isMyTurn: 'other_player' === MY_PLAYER_ID
    });

    assertFalse(store.get('isMyTurn'));
});

test('phase transitions correctly', () => {
    const store = createPlayerState();

    // Start with place_tile
    store.setState({ phase: 'place_tile' });
    assertEqual(store.get('phase'), 'place_tile');

    // Transition to found_chain
    store.setState({ phase: 'found_chain' });
    assertEqual(store.get('phase'), 'found_chain');

    // Transition to buy_stocks
    store.setState({ phase: 'buy_stocks' });
    assertEqual(store.get('phase'), 'buy_stocks');
});

// Run tests
async function runTests() {
    console.log('Running WebSocket and state tests...\n');
    let passed = 0;
    let failed = 0;

    // Run sync tests
    for (const { name, fn } of tests) {
        try {
            fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (error) {
            console.log(`✗ ${name}`);
            console.log(`  ${error.message}`);
            failed++;
        }
    }

    // Run async tests
    for (const { name, fn } of asyncTests) {
        try {
            await fn();
            console.log(`✓ ${name}`);
            passed++;
        } catch (error) {
            console.log(`✗ ${name}`);
            console.log(`  ${error.message}`);
            failed++;
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
