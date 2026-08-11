/**
 * AstcFile - Build/parse the plain ".astc" file format used by ARM's
 * reference `astcenc` tool (https://github.com/ARM-software/astc-encoder)
 * and consumed by engines that call it directly (e.g. OpenFL/Lime's
 * Context3D.createASTCTexture()) - a 16-byte header followed by the raw
 * ASTC block stream, with NO KTX2/Basis container involved:
 *
 *   offset 0:  magic     uint32 LE  0x5CA1AB13
 *   offset 4:  block_x   uint8
 *   offset 5:  block_y   uint8
 *   offset 6:  block_z   uint8      (always 1 for a 2D texture)
 *   offset 7:  dim_x     uint24 LE  (3 bytes, least-significant first)
 *   offset 10: dim_y     uint24 LE
 *   offset 13: dim_z     uint24 LE  (always 1 for a 2D texture)
 *  (16 bytes total, then the raw compressed blocks)
 *
 * This is a completely different byte layout from a KTX2 file (which has
 * its own 12-byte identifier, a totally different field layout, and wraps
 * the compressed data behind a level index) - a KTX2 file saved with a
 * ".astc" extension will not parse as one of these no matter how it's
 * renamed.
 */

const MAGIC = 0x5CA1AB13;
const HEADER_SIZE = 16;

function parseBlockSize(blockSize) {
    const [bx, by] = blockSize.split('x').map(Number);
    if (!bx || !by) throw new Error(`AstcFile: invalid block size "${blockSize}"`);
    return { blockX: bx, blockY: by };
}

function writeU24LE(bytes, offset, value) {
    bytes[offset] = value & 0xFF;
    bytes[offset + 1] = (value >> 8) & 0xFF;
    bytes[offset + 2] = (value >> 16) & 0xFF;
}

function readU24LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

/**
 * Wrap a raw ASTC block stream with the astcenc file header.
 * @param {Uint8Array} blockBytes - Raw compressed ASTC blocks, no header.
 * @param {number} width - Texture width in pixels.
 * @param {number} height - Texture height in pixels.
 * @param {string} blockSize - e.g. '4x4'.
 * @returns {Uint8Array}
 */
function wrapRawBlocks(blockBytes, width, height, blockSize) {
    const { blockX, blockY } = parseBlockSize(blockSize);

    const out = new Uint8Array(HEADER_SIZE + blockBytes.length);
    const view = new DataView(out.buffer);

    view.setUint32(0, MAGIC, true);
    out[4] = blockX;
    out[5] = blockY;
    out[6] = 1; // block_z - this project only ever produces 2D textures
    writeU24LE(out, 7, width);
    writeU24LE(out, 10, height);
    writeU24LE(out, 13, 1); // dim_z

    out.set(blockBytes, HEADER_SIZE);
    return out;
}

/**
 * Parse an astcenc-format .astc file back into its header fields + raw
 * block bytes. Used by the regression test to verify wrapRawBlocks()
 * round-trips, and available for any future read-back need.
 */
function parse(bytes) {
    if (bytes.length < HEADER_SIZE) {
        throw new Error('AstcFile: buffer shorter than the 16-byte header');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    if (magic !== MAGIC) {
        throw new Error(`AstcFile: bad magic 0x${magic.toString(16)}, expected 0x${MAGIC.toString(16)}`);
    }
    return {
        blockX: bytes[4],
        blockY: bytes[5],
        blockZ: bytes[6],
        width: readU24LE(bytes, 7),
        height: readU24LE(bytes, 10),
        depth: readU24LE(bytes, 13),
        blockBytes: bytes.subarray(HEADER_SIZE)
    };
}

const KTX2_IDENTIFIER = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

/**
 * Extract the raw compressed bytes of mip level 0 out of a KTX2 container,
 * for repackaging as a plain .astc file via wrapRawBlocks().
 *
 * Only supports supercompressionScheme === 0 (none) - the caller is
 * expected to have disabled KTX2 supercompression on the encoder before
 * calling this, so the level data is exactly the raw ASTC block stream
 * with nothing further to decompress.
 *
 * @param {Uint8Array} ktx2Bytes
 * @returns {{ width: number, height: number, blockBytes: Uint8Array }}
 */
function extractLevel0FromKtx2(ktx2Bytes) {
    for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
        if (ktx2Bytes[i] !== KTX2_IDENTIFIER[i]) {
            throw new Error('AstcFile: not a KTX2 file (bad identifier)');
        }
    }

    const view = new DataView(ktx2Bytes.buffer, ktx2Bytes.byteOffset, ktx2Bytes.byteLength);

    const pixelWidth = view.getUint32(20, true);
    const pixelHeight = view.getUint32(24, true);
    const levelCount = view.getUint32(40, true);
    const supercompressionScheme = view.getUint32(44, true);

    if (supercompressionScheme !== 0) {
        throw new Error(
            `AstcFile: KTX2 supercompressionScheme ${supercompressionScheme} is not supported - ` +
            `disable KTX2 supercompression on the encoder so level data is stored raw`
        );
    }
    if (levelCount < 1) {
        throw new Error('AstcFile: KTX2 file has no mip levels');
    }

    // Level index starts right after the 80-byte fixed header, one 24-byte
    // entry per level: byteOffset (u64), byteLength (u64), uncompressedByteLength (u64).
    const level0IndexOffset = 80;
    const byteOffsetLo = view.getUint32(level0IndexOffset, true);
    const byteOffsetHi = view.getUint32(level0IndexOffset + 4, true);
    const byteLengthLo = view.getUint32(level0IndexOffset + 8, true);
    const byteLengthHi = view.getUint32(level0IndexOffset + 12, true);

    if (byteOffsetHi !== 0 || byteLengthHi !== 0) {
        throw new Error('AstcFile: KTX2 level offset/length exceeds 4GB, unsupported');
    }

    const blockBytes = ktx2Bytes.subarray(byteOffsetLo, byteOffsetLo + byteLengthLo);

    return { width: pixelWidth, height: pixelHeight, blockBytes };
}

export default {
    MAGIC,
    HEADER_SIZE,
    wrapRawBlocks,
    parse,
    extractLevel0FromKtx2
};
