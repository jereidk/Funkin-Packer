/**
 * bytesToBinaryString - Convert a Uint8Array to a JS binary string
 * (one char code per byte), safe for btoa().
 *
 * `String.fromCharCode(...bytes)` spreads every element as a separate
 * function argument - fine for small buffers, but a large texture's
 * compressed bytes (millions of elements for a several-thousand-pixel
 * ASTC/PNG export) blows past the engine's argument-count limit and throws
 * "Maximum call stack size exceeded". Chunking keeps each fromCharCode
 * call well under that limit.
 */
function bytesToBinaryString(bytes) {
    const CHUNK_SIZE = 0x8000; // 32768
    let result = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        result += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
    }
    return result;
}

export default bytesToBinaryString;
export { bytesToBinaryString };
