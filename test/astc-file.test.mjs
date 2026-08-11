/**
 * Regression test for AstcFile.js - the plain ".astc" file format ARM's
 * astcenc tool produces and OpenFL/Lime's createASTCTexture() consumes.
 *
 * Run with: node test/astc-file.test.mjs
 *
 * Context: FunkyPacker's ASTC export previously produced a KTX2 container
 * (from the Basis Universal WASM encoder) or headerless raw blocks (from
 * the JS fallback), both saved with a ".astc" extension. Neither matches
 * the real consumer's expected byte layout - a 16-byte astcenc header
 * (magic 0x5CA1AB13 + block dims + width/height) directly followed by the
 * raw ASTC block stream, no container at all. This module builds that
 * exact format and extracts the equivalent raw bytes back out of a KTX2
 * container so the WASM encoder's output can be repackaged into it.
 */

import AstcFile from '../src/client/utils/astc/AstcFile.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

console.log('=== wrapRawBlocks() / parse() round-trip ===');
runs++;
{
    const width = 130, height = 67, blockSize = '6x6';
    const blocksX = Math.ceil(width / 6), blocksY = Math.ceil(height / 6);
    const blockBytes = new Uint8Array(blocksX * blocksY * 16);
    for (let i = 0; i < blockBytes.length; i++) blockBytes[i] = i % 256;

    const file = AstcFile.wrapRawBlocks(blockBytes, width, height, blockSize);

    if (file.length !== AstcFile.HEADER_SIZE + blockBytes.length) {
        fail('length', `expected ${AstcFile.HEADER_SIZE + blockBytes.length}, got ${file.length}`);
    }

    const parsed = AstcFile.parse(file);
    if (parsed.width !== width) fail('width', `expected ${width}, got ${parsed.width}`);
    if (parsed.height !== height) fail('height', `expected ${height}, got ${parsed.height}`);
    if (parsed.blockX !== 6) fail('blockX', `expected 6, got ${parsed.blockX}`);
    if (parsed.blockY !== 6) fail('blockY', `expected 6, got ${parsed.blockY}`);
    if (parsed.blockZ !== 1) fail('blockZ', `expected 1, got ${parsed.blockZ}`);
    if (parsed.depth !== 1) fail('depth', `expected 1, got ${parsed.depth}`);
    if (parsed.blockBytes.length !== blockBytes.length) {
        fail('blockBytes length', `expected ${blockBytes.length}, got ${parsed.blockBytes.length}`);
    } else {
        for (let i = 0; i < blockBytes.length; i++) {
            if (parsed.blockBytes[i] !== blockBytes[i]) {
                fail('blockBytes content', `mismatch at byte ${i}`);
                break;
            }
        }
    }
}

console.log('=== magic bytes match the real astcenc tool (0x5CA1AB13, little-endian) ===');
runs++;
{
    const file = AstcFile.wrapRawBlocks(new Uint8Array(16), 4, 4, '4x4');
    // Little-endian encoding of 0x5CA1AB13 is bytes [0x13, 0xAB, 0xA1, 0x5C]
    const expected = [0x13, 0xAB, 0xA1, 0x5C];
    for (let i = 0; i < 4; i++) {
        if (file[i] !== expected[i]) {
            fail('magic bytes', `byte ${i}: expected 0x${expected[i].toString(16)}, got 0x${file[i].toString(16)}`);
        }
    }
}

console.log('=== parse() rejects a buffer with the wrong magic ===');
runs++;
{
    const bad = new Uint8Array(20);
    let threw = false;
    try { AstcFile.parse(bad); } catch (e) { threw = true; }
    if (!threw) fail('bad magic rejection', 'expected parse() to throw on an all-zero buffer');
}

console.log('=== extractLevel0FromKtx2() pulls the right bytes out of a synthetic KTX2 file ===');
runs++;
{
    // Build a minimal but spec-correct KTX2 file by hand: 80-byte fixed
    // header, one level-index entry (24 bytes), then the level's raw data.
    const levelBytes = new Uint8Array(64);
    for (let i = 0; i < levelBytes.length; i++) levelBytes[i] = (i * 7 + 3) % 256;

    const levelIndexOffset = 80;
    const levelDataOffset = levelIndexOffset + 24; // one level, no DFD/KVD for this test
    const total = levelDataOffset + levelBytes.length;

    const buf = new Uint8Array(total);
    const view = new DataView(buf.buffer);

    const identifier = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
    buf.set(identifier, 0);

    view.setUint32(12, 0, true);   // vkFormat (unused by the extractor)
    view.setUint32(16, 1, true);   // typeSize
    view.setUint32(20, 91, true);  // pixelWidth
    view.setUint32(24, 55, true);  // pixelHeight
    view.setUint32(28, 1, true);   // pixelDepth
    view.setUint32(32, 0, true);   // layerCount
    view.setUint32(36, 1, true);   // faceCount
    view.setUint32(40, 1, true);   // levelCount
    view.setUint32(44, 0, true);   // supercompressionScheme = none

    // Level index entry 0: byteOffset/byteLength/uncompressedByteLength (u64 each, LE)
    view.setUint32(levelIndexOffset, levelDataOffset, true);
    view.setUint32(levelIndexOffset + 4, 0, true);
    view.setUint32(levelIndexOffset + 8, levelBytes.length, true);
    view.setUint32(levelIndexOffset + 12, 0, true);
    view.setUint32(levelIndexOffset + 16, levelBytes.length, true);
    view.setUint32(levelIndexOffset + 20, 0, true);

    buf.set(levelBytes, levelDataOffset);

    const extracted = AstcFile.extractLevel0FromKtx2(buf);
    if (extracted.width !== 91) fail('extract width', `expected 91, got ${extracted.width}`);
    if (extracted.height !== 55) fail('extract height', `expected 55, got ${extracted.height}`);
    if (extracted.blockBytes.length !== levelBytes.length) {
        fail('extract length', `expected ${levelBytes.length}, got ${extracted.blockBytes.length}`);
    } else {
        for (let i = 0; i < levelBytes.length; i++) {
            if (extracted.blockBytes[i] !== levelBytes[i]) {
                fail('extract content', `mismatch at byte ${i}`);
                break;
            }
        }
    }
}

console.log('=== extractLevel0FromKtx2() rejects supercompressed levels ===');
runs++;
{
    const buf = new Uint8Array(104);
    const view = new DataView(buf.buffer);
    const identifier = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];
    buf.set(identifier, 0);
    view.setUint32(40, 1, true);  // levelCount
    view.setUint32(44, 2, true);  // supercompressionScheme = Zstd - must be rejected

    let threw = false;
    try { AstcFile.extractLevel0FromKtx2(buf); } catch (e) { threw = true; }
    if (!threw) fail('supercompression rejection', 'expected extractLevel0FromKtx2() to throw on scheme=2 (Zstd)');
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
