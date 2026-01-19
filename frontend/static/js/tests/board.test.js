/**
 * Tests for board parsing logic
 * These tests can run in Node.js without DOM
 */

import { parseTile, formatTile } from '../shared/formatters.js';
import { BOARD, CHAIN_NAMES, CONFIG } from '../shared/constants.js';

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

function assertTrue(actual, message = '') {
    if (!actual) {
        throw new Error(`${message} Expected truthy, got ${actual}`);
    }
}

// Board constants tests
test('BOARD has correct dimensions', () => {
    assertEqual(BOARD.columns, 12);
    assertEqual(BOARD.rows.length, 9);
    assertEqual(BOARD.minColumn, 1);
    assertEqual(BOARD.maxColumn, 12);
});

test('BOARD rows are A-I', () => {
    assertDeepEqual(BOARD.rows, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
});

// Tile parsing tests
test('parseTile handles all valid column numbers', () => {
    for (let col = 1; col <= 12; col++) {
        const result = parseTile(`${col}A`);
        assertEqual(result.col, col);
        assertEqual(result.row, 'A');
    }
});

test('parseTile handles all valid row letters', () => {
    for (const row of BOARD.rows) {
        const result = parseTile(`1${row}`);
        assertEqual(result.col, 1);
        assertEqual(result.row, row);
    }
});

test('parseTile rejects invalid rows', () => {
    assertEqual(parseTile('1J'), null);
    assertEqual(parseTile('1K'), null);
    assertEqual(parseTile('1Z'), null);
});

test('parseTile rejects invalid columns', () => {
    assertEqual(parseTile('0A'), null);
    assertEqual(parseTile('13A'), null);
});

// Board data structure tests
test('board cells object is parsed correctly', () => {
    // Simulate board data from server
    const boardData = {
        cells: {
            "1A": { state: "played", chain: null },
            "2A": { state: "in_chain", chain: "Luxor" },
            "3B": { state: "in_chain", chain: "Tower" }
        }
    };

    // Parse each cell
    for (const [tileKey, cellData] of Object.entries(boardData.cells)) {
        const parsed = parseTile(tileKey);
        assertTrue(parsed !== null, `${tileKey} should parse`);
        assertTrue(typeof parsed.col === 'number');
        assertTrue(typeof parsed.row === 'string');
    }
});

// Chain constants tests
test('CHAIN_NAMES has 7 chains', () => {
    assertEqual(CHAIN_NAMES.length, 7);
});

test('CHAIN_NAMES are all lowercase', () => {
    for (const name of CHAIN_NAMES) {
        assertEqual(name, name.toLowerCase());
    }
});

// Config tests
test('CONFIG has expected safe chain size', () => {
    assertEqual(CONFIG.safeChainSize, 11);
});

test('CONFIG has expected max stocks per turn', () => {
    assertEqual(CONFIG.maxStocksPerTurn, 3);
});

test('CONFIG has expected starting money', () => {
    assertEqual(CONFIG.startingMoney, 6000);
});

// formatTile round-trip tests
test('formatTile and parseTile are inverses', () => {
    for (let col = 1; col <= 12; col++) {
        for (const row of BOARD.rows) {
            const tileStr = formatTile(col, row);
            const parsed = parseTile(tileStr);
            assertEqual(parsed.col, col);
            assertEqual(parsed.row, row);
        }
    }
});

// Board cell ID generation tests
test('cell IDs follow expected format', () => {
    // This is how we generate cell IDs in the code
    function getCellId(col, row) {
        return `cell-${col}-${row}`;
    }

    assertEqual(getCellId(1, 'A'), 'cell-1-A');
    assertEqual(getCellId(12, 'I'), 'cell-12-I');
});

// Run tests
console.log('Running board tests...\n');
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
