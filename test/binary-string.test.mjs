/**
 * Regression test for BinaryString.js's bytesToBinaryString().
 *
 * Run with: node test/binary-string.test.mjs
 *
 * Reported directly by the user: exporting ASTC for a large (3779x3323)
 * texture threw "Unhandled promise rejection: RangeError: Maximum call
 * stack size exceeded". Root cause: APP.js converted the compressed bytes
 * to a binary string via `String.fromCharCode(...bytes)`, which spreads
 * every byte as a separate function argument - fine for a small buffer,
 * but a large ASTC/PNG export can be millions of bytes, and V8 (and every
 * other JS engine) caps how many arguments a single function call can take.
 */

import { bytesToBinaryString } from '../src/client/utils/BinaryString.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

console.log('=== matches String.fromCharCode(...) on a small buffer ===');
runs++;
{
    const bytes = new Uint8Array([0, 1, 2, 65, 66, 67, 255, 128]);
    const expected = String.fromCharCode(...bytes);
    const actual = bytesToBinaryString(bytes);
    if (actual !== expected) {
        fail('small buffer parity', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

console.log('=== handles an empty buffer ===');
runs++;
{
    if (bytesToBinaryString(new Uint8Array(0)) !== '') {
        fail('empty buffer', 'expected empty string');
    }
}

console.log('=== does not throw on a buffer large enough that spread would blow the call stack ===');
runs++;
{
    // Matches the reported real-world case: a 3779x3323 texture at ASTC 8x8
    // is ~3MB of compressed bytes - several million char codes, far past
    // what String.fromCharCode(...bytes) can take as one argument list.
    const big = new Uint8Array(6_000_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;

    let threw = false;
    let result = '';
    try {
        result = bytesToBinaryString(big);
    } catch (e) {
        threw = true;
        console.log(`  threw: ${e.constructor.name}: ${e.message}`);
    }

    if (threw) fail('large buffer', 'bytesToBinaryString threw on a 6,000,000-byte buffer');
    if (!threw && result.length !== big.length) {
        fail('large buffer length', `expected length ${big.length}, got ${result.length}`);
    }
}

console.log('=== spreading the same large buffer directly WOULD throw (sanity check the bug is real) ===');
runs++;
{
    const big = new Uint8Array(6_000_000);
    let threw = false;
    try {
        String.fromCharCode(...big);
    } catch (e) {
        threw = true;
    }
    if (!threw) {
        fail('bug reproduction sanity check', 'expected the naive spread approach to throw on a 6M-byte buffer - if it did not, this environment\'s engine limit is unusually high and the test fixture should use a larger buffer');
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
