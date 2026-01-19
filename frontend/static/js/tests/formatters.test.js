/**
 * Tests for shared/formatters.js
 * Run with: node --experimental-vm-modules formatters.test.js
 * Or in browser console after loading the module
 */

// For Node.js testing without DOM
const mockDocument = {
    createElement: (tag) => ({
        textContent: '',
        get innerHTML() { return this.textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    })
};

// Polyfill for Node.js
if (typeof document === 'undefined') {
    globalThis.document = mockDocument;
}

import {
    formatMoney,
    capitalize,
    escapeHtml,
    parseTile,
    formatTile,
    formatOrdinal,
    pluralize
} from '../shared/formatters.js';

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

function assertNull(actual, message = '') {
    if (actual !== null) {
        throw new Error(`${message} Expected null, got ${JSON.stringify(actual)}`);
    }
}

// formatMoney tests
test('formatMoney formats positive numbers', () => {
    assertEqual(formatMoney(1000), '$1,000');
    assertEqual(formatMoney(6000), '$6,000');
    assertEqual(formatMoney(1234567), '$1,234,567');
});

test('formatMoney handles zero', () => {
    assertEqual(formatMoney(0), '$0');
});

test('formatMoney handles null/undefined', () => {
    assertEqual(formatMoney(null), '$0');
    assertEqual(formatMoney(undefined), '$0');
});

test('formatMoney handles strings', () => {
    assertEqual(formatMoney('1000'), '$1,000');
});

// capitalize tests
test('capitalize works on lowercase strings', () => {
    assertEqual(capitalize('luxor'), 'Luxor');
    assertEqual(capitalize('hello'), 'Hello');
});

test('capitalize handles empty/null strings', () => {
    assertEqual(capitalize(''), '');
    assertEqual(capitalize(null), '');
    assertEqual(capitalize(undefined), '');
});

test('capitalize handles already capitalized', () => {
    assertEqual(capitalize('Luxor'), 'Luxor');
});

// parseTile tests
test('parseTile parses simple tiles', () => {
    assertDeepEqual(parseTile('1A'), { col: 1, row: 'A' });
    assertDeepEqual(parseTile('5C'), { col: 5, row: 'C' });
    assertDeepEqual(parseTile('12I'), { col: 12, row: 'I' });
});

test('parseTile returns null for invalid tiles', () => {
    assertNull(parseTile(''));
    assertNull(parseTile(null));
    assertNull(parseTile('AA'));
    assertNull(parseTile('1'));
    assertNull(parseTile('A1')); // Wrong order
    assertNull(parseTile('1J')); // Invalid row
    assertNull(parseTile('13A')); // Invalid column
});

// formatTile tests
test('formatTile creates tile strings', () => {
    assertEqual(formatTile(1, 'A'), '1A');
    assertEqual(formatTile(12, 'I'), '12I');
});

// formatOrdinal tests
test('formatOrdinal adds correct suffixes', () => {
    assertEqual(formatOrdinal(1), '1st');
    assertEqual(formatOrdinal(2), '2nd');
    assertEqual(formatOrdinal(3), '3rd');
    assertEqual(formatOrdinal(4), '4th');
    assertEqual(formatOrdinal(11), '11th');
    assertEqual(formatOrdinal(12), '12th');
    assertEqual(formatOrdinal(13), '13th');
    assertEqual(formatOrdinal(21), '21st');
    assertEqual(formatOrdinal(22), '22nd');
    assertEqual(formatOrdinal(23), '23rd');
});

// pluralize tests
test('pluralize handles singular', () => {
    assertEqual(pluralize(1, 'stock'), 'stock');
    assertEqual(pluralize(1, 'share'), 'share');
});

test('pluralize handles plural', () => {
    assertEqual(pluralize(0, 'stock'), 'stocks');
    assertEqual(pluralize(2, 'stock'), 'stocks');
    assertEqual(pluralize(10, 'share'), 'shares');
});

test('pluralize handles custom plural', () => {
    assertEqual(pluralize(2, 'company', 'companies'), 'companies');
});

// Run tests
console.log('Running formatter tests...\n');
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
