/**
 * Regression test for BasisEncoder.js's total-pixel-count guard.
 *
 * Run with: node test/basis-encoder-pixel-limit.test.mjs
 *
 * The prebuilt basis_encoder.wasm binary this project ships has a hard
 * internal limit on total pixel count, independent of aspect ratio -
 * bisected directly against the real .wasm (see the E2E investigation this
 * fix came from): 2048x2048 (4,194,304 px) succeeds, anything above that
 * fails with an opaque "encode() returned 0", and the limit tracks total
 * pixels rather than either dimension alone (a 4096x1024 image, same total
 * pixel count as 2048x2048, succeeds; a 2200x1000 image, narrower total but
 * width > 2048, also succeeds). Reported directly: a real 3779x3323 (12.6MP)
 * export hit this and silently fell back to the crude JS encoder with no
 * useful diagnostic. encode() now checks total pixel count up front and
 * throws a clear, specific error before attempting (and wasting time on) a
 * doomed WASM call - this doesn't require the actual WASM module to be
 * loaded, since the check runs before any module access.
 */

import basisEncoder from '../src/client/utils/astc/BasisEncoder.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function fakeImageData(width, height) {
    return { data: new Uint8Array(width * height * 4), width, height };
}

console.log('=== a 2048x2048 image (exactly at the limit) does not trip the pre-check ===');
runs++;
{
    let threw = false, message = '';
    try {
        await basisEncoder.encode(fakeImageData(2048, 2048), { blockSize: '4x4' });
    } catch (e) {
        threw = true;
        message = e.message;
    }
    // Without a loaded WASM module this call will still fail eventually
    // (this.module is null) - what matters is that it does NOT fail with
    // the pixel-limit message, i.e. the pre-check itself didn't reject it.
    if (threw && message.includes('exceeds this WASM build')) {
        fail('2048x2048 boundary', `expected the pixel-limit pre-check to pass at exactly the limit, got: ${message}`);
    }
}

console.log('=== a 3779x3323 image (the real reported case, 12.6MP) is rejected with a clear message ===');
runs++;
{
    let threw = false, message = '';
    try {
        await basisEncoder.encode(fakeImageData(3779, 3323), { blockSize: '8x8' });
    } catch (e) {
        threw = true;
        message = e.message;
    }
    if (!threw || !message.includes('exceeds this WASM build')) {
        fail('3779x3323 rejection', `expected a clear pixel-limit error, got: threw=${threw} message=${message}`);
    }
}

console.log('=== the limit is total pixels, not either dimension alone (4096x1024 == 2048x2048 total) ===');
runs++;
{
    let threw = false, message = '';
    try {
        await basisEncoder.encode(fakeImageData(4096, 1024), { blockSize: '4x4' });
    } catch (e) {
        threw = true;
        message = e.message;
    }
    if (threw && message.includes('exceeds this WASM build')) {
        fail('4096x1024 same-total-pixels', `expected this to pass the pre-check (same total pixels as 2048x2048), got: ${message}`);
    }
}

console.log('=== a small image is well within the limit ===');
runs++;
{
    let threw = false, message = '';
    try {
        await basisEncoder.encode(fakeImageData(256, 256), { blockSize: '4x4' });
    } catch (e) {
        threw = true;
        message = e.message;
    }
    if (threw && message.includes('exceeds this WASM build')) {
        fail('small image', `did not expect the pixel-limit error for a 256x256 image, got: ${message}`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
