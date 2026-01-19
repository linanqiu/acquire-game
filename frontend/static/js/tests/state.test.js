/**
 * Tests for shared/state.js
 */

import { createStore, createHostState, createPlayerState } from '../shared/state.js';

// Simple test runner
const tests = [];
function test(name, fn) {
    tests.push({ name, fn });
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

// createStore tests
test('createStore initializes with given state', () => {
    const store = createStore({ count: 0, name: 'test' });
    const state = store.getState();
    assertEqual(state.count, 0);
    assertEqual(state.name, 'test');
});

test('createStore.get retrieves single value', () => {
    const store = createStore({ count: 5 });
    assertEqual(store.get('count'), 5);
});

test('createStore.setState updates state', () => {
    const store = createStore({ count: 0 });
    store.setState({ count: 10 });
    assertEqual(store.get('count'), 10);
});

test('createStore.setState merges state', () => {
    const store = createStore({ count: 0, name: 'test' });
    store.setState({ count: 5 });
    assertEqual(store.get('count'), 5);
    assertEqual(store.get('name'), 'test');
});

test('createStore.setState accepts function', () => {
    const store = createStore({ count: 5 });
    store.setState(state => ({ count: state.count + 1 }));
    assertEqual(store.get('count'), 6);
});

test('createStore.subscribe notifies on changes', () => {
    const store = createStore({ count: 0 });
    let notified = false;
    let receivedState = null;
    let receivedPrev = null;

    store.subscribe((state, prev) => {
        notified = true;
        receivedState = state;
        receivedPrev = prev;
    });

    store.setState({ count: 5 });

    assertEqual(notified, true);
    assertEqual(receivedState.count, 5);
    assertEqual(receivedPrev.count, 0);
});

test('createStore.subscribe returns unsubscribe function', () => {
    const store = createStore({ count: 0 });
    let callCount = 0;

    const unsubscribe = store.subscribe(() => {
        callCount++;
    });

    store.setState({ count: 1 });
    assertEqual(callCount, 1);

    unsubscribe();
    store.setState({ count: 2 });
    assertEqual(callCount, 1); // Should not have been called again
});

test('createStore.reset returns to initial state', () => {
    const store = createStore({ count: 0, name: 'initial' });
    store.setState({ count: 100, name: 'changed' });
    store.reset();

    assertEqual(store.get('count'), 0);
    assertEqual(store.get('name'), 'initial');
});

test('createStore.getState returns copy not reference', () => {
    const store = createStore({ items: [1, 2, 3] });
    const state1 = store.getState();
    const state2 = store.getState();

    // Should be equal but not the same object
    assertDeepEqual(state1, state2);
    assertEqual(state1 !== state2, true);
});

// createHostState tests
test('createHostState creates host-specific state', () => {
    const store = createHostState();
    const state = store.getState();

    assertEqual(state.board, null);
    assertEqual(state.hotel, null);
    assertDeepEqual(state.players, {});
    assertEqual(state.currentPlayer, null);
    assertEqual(state.phase, null);
    assertEqual(state.tilesRemaining, 0);
    assertDeepEqual(state.turnOrder, []);
    assertEqual(state.isGameStarted, false);
    assertEqual(state.connectionStatus, 'disconnected');
});

// createPlayerState tests
test('createPlayerState creates player-specific state', () => {
    const store = createPlayerState();
    const state = store.getState();

    assertDeepEqual(state.tiles, []);
    assertEqual(state.money, 6000);
    assertDeepEqual(state.stocks, {});
    assertDeepEqual(state.chains, {});
    assertEqual(state.board, null);
    assertEqual(state.currentPlayer, null);
    assertEqual(state.phase, null);
    assertDeepEqual(state.players, {});
    assertEqual(state.isMyTurn, false);
    assertEqual(state.selectedTile, null);
    assertEqual(state.connectionStatus, 'disconnected');
});

// Run tests
console.log('Running state tests...\n');
let passed = 0;
let failed = 0;

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

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
