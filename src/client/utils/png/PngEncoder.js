/**
 * PngEncoder - writes real PNG files with adaptive scanline filtering and
 * automatic colour-type selection.
 *
 * The deflate implementation is injected rather than imported so this module
 * stays dependency-free and can be tested under node with the built-in zlib.
 * In the browser PngCompressor supplies pako.
 *
 * Only IHDR / PLTE / tRNS / IDAT / IEND are emitted - no ancillary chunks, so
 * the output carries no metadata by construction.
 */

// Extension is explicit so this module also loads under plain node for the tests
import { buildPalette, mapToPalette, extractExactPalette, MAX_PALETTE } from './ColorQuantizer.js';

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export const COLOR_TYPE = {
    GRAYSCALE: 0,
    RGB: 2,
    PALETTE: 3,
    RGBA: 6
};

let crcTable = null;

function getCrcTable() {
    if (crcTable) return crcTable;

    crcTable = new Int32Array(256);

    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[n] = c;
    }

    return crcTable;
}

function crc32(buf, start, end) {
    const table = getCrcTable();
    let c = -1;

    for (let i = start; i < end; i++) {
        c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }

    return (c ^ -1) >>> 0;
}

function makeChunk(type, data) {
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);

    view.setUint32(0, data.length);
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    out.set(data, 8);
    view.setUint32(data.length + 8, crc32(out, 4, data.length + 8));

    return out;
}

function concat(parts) {
    let total = 0;
    for (const p of parts) total += p.length;

    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.length;
    }

    return out;
}

function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);

    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/**
 * Filter each scanline, choosing per line whichever filter minimises the sum of
 * absolute signed differences - the standard libpng heuristic and where most of
 * the lossless gain over a naive encoder comes from.
 *
 * @param filters which filter types to consider. Palette data is not numerically
 *        continuous, so filtering it usually hurts; callers pass [0] there.
 */
function filterByte(raw, off, prevOff, i, bpp, type) {
    const x = raw[off + i];
    if (type === 0) return x;

    const a = i >= bpp ? raw[off + i - bpp] : 0;
    if (type === 1) return (x - a) & 0xFF;

    const b = prevOff >= 0 ? raw[prevOff + i] : 0;
    if (type === 2) return (x - b) & 0xFF;
    if (type === 3) return (x - ((a + b) >> 1)) & 0xFF;

    const c = (prevOff >= 0 && i >= bpp) ? raw[prevOff + i - bpp] : 0;
    return (x - paethPredictor(a, b, c)) & 0xFF;
}

function filterScanlines(raw, height, lineBytes, bpp, filters) {
    const out = new Uint8Array((lineBytes + 1) * height);

    // Scoring all five candidates over every byte is the most expensive step on a
    // large atlas. Sampling the score and then materialising only the winner picks
    // the same filter in practice while doing roughly a third of the work.
    const stride = lineBytes > 8192 ? 4 : (lineBytes > 2048 ? 2 : 1);

    let outPos = 0;
    let prevOff = -1;

    for (let y = 0; y < height; y++) {
        const off = y * lineBytes;
        let best = filters[0];

        if (filters.length > 1) {
            let bestScore = Infinity;

            for (let f = 0; f < filters.length; f++) {
                const type = filters[f];
                let score = 0;

                for (let i = 0; i < lineBytes; i += stride) {
                    const v = filterByte(raw, off, prevOff, i, bpp, type);
                    score += v < 128 ? v : 256 - v;
                }

                if (score < bestScore) {
                    bestScore = score;
                    best = type;
                }
            }
        }

        out[outPos++] = best;

        for (let i = 0; i < lineBytes; i++) {
            out[outPos + i] = filterByte(raw, off, prevOff, i, bpp, best);
        }

        outPos += lineBytes;
        prevOff = off;
    }

    return out;
}

function bitDepthFor(paletteSize) {
    if (paletteSize <= 2) return 1;
    if (paletteSize <= 4) return 2;
    if (paletteSize <= 16) return 4;
    return 8;
}

/**
 * Pack palette indices into scanlines at the given bit depth.
 */
function packIndices(indices, width, height, bitDepth) {
    const lineBytes = Math.ceil(width * bitDepth / 8);
    const raw = new Uint8Array(lineBytes * height);

    if (bitDepth === 8) {
        for (let y = 0; y < height; y++) {
            raw.set(indices.subarray(y * width, (y + 1) * width), y * lineBytes);
        }
        return { raw, lineBytes };
    }

    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;

    for (let y = 0; y < height; y++) {
        const lineOff = y * lineBytes;

        for (let x = 0; x < width; x++) {
            const value = indices[y * width + x] & mask;
            const byte = lineOff + Math.floor(x / perByte);
            const shift = 8 - bitDepth * ((x % perByte) + 1);
            raw[byte] |= value << shift;
        }
    }

    return { raw, lineBytes };
}

function buildTruecolorRaw(rgba, width, height, hasAlpha) {
    const channels = hasAlpha ? 4 : 3;
    const lineBytes = width * channels;
    const raw = new Uint8Array(lineBytes * height);

    let out = 0;
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
        raw[out++] = rgba[p];
        raw[out++] = rgba[p + 1];
        raw[out++] = rgba[p + 2];
        if (hasAlpha) raw[out++] = rgba[p + 3];
    }

    return { raw, lineBytes, channels };
}

function imageHasAlpha(rgba, pixelCount) {
    for (let i = 0, p = 3; i < pixelCount; i++, p += 4) {
        if (rgba[p] !== 255) return true;
    }
    return false;
}

/**
 * Encode RGBA pixels as a PNG.
 *
 * @param {{data: Uint8Array|Uint8ClampedArray, width: number, height: number}} image
 * @param {Object} options
 * @param {function(Uint8Array): Uint8Array} options.deflate - zlib-format deflate
 * @param {number} [options.maxColors=256] - palette ceiling when quantizing
 * @param {boolean} [options.quantize=true] - allow lossy palette reduction
 * @param {boolean} [options.dither=true] - Floyd-Steinberg when quantizing
 * @returns {{data: Uint8Array, colorType: number, bitDepth: number, paletteSize: number, quantized: boolean}}
 */
export function encodePng(image, options = {}) {
    const { data: rgba, width, height } = image;
    const deflate = options.deflate;

    if (typeof deflate !== 'function') {
        throw new Error('PngEncoder: options.deflate is required');
    }
    if (!width || !height) {
        throw new Error(`PngEncoder: invalid dimensions ${width}x${height}`);
    }
    if (rgba.length < width * height * 4) {
        throw new Error(`PngEncoder: expected ${width * height * 4} bytes of RGBA, got ${rgba.length}`);
    }

    const pixelCount = width * height;
    const allowQuantize = options.quantize !== false;
    const maxColors = Math.max(2, Math.min(options.maxColors || MAX_PALETTE, MAX_PALETTE));

    // An image that already fits a palette is indexed with no loss whatsoever -
    // the common case for pixel art and flat-shaded sprites, and always smaller
    // than truecolour at 1 byte (or less) per pixel.
    const exact = extractExactPalette(rgba, width, height, MAX_PALETTE);

    if (exact) {
        return assemble(width, height, rgba, deflate, {
            palette: exact.palette,
            indices: exact.indices,
            quantized: false
        });
    }

    if (!allowQuantize) {
        return assemble(width, height, rgba, deflate, { palette: null });
    }

    const palette = buildPalette(rgba, width, height, maxColors);
    const indices = mapToPalette(rgba, width, height, palette, options.dither !== false);

    const reduced = assemble(width, height, rgba, deflate, {
        palette: palette,
        indices: indices,
        quantized: true
    });

    // Quantizing is not automatically a win: dithering a smooth gradient injects
    // noise that deflates far worse than the filtered truecolour original. Encode
    // both and ship the smaller, so "compress" can never inflate a file.
    //
    // This costs a second full encode (~30% of total time on a 4096x4096 sheet).
    // Callers that know their input is sprite art - where the palette always wins
    // by a wide margin - can set compareLossless: false to skip it.
    if (options.compareLossless === false) return reduced;

    const truecolor = assemble(width, height, rgba, deflate, { palette: null });

    return reduced.data.length <= truecolor.data.length ? reduced : truecolor;
}

/**
 * Serialise one encoding choice into a complete PNG.
 */
function assemble(width, height, rgba, deflate, plan) {
    const chunks = [SIGNATURE];
    const palette = plan.palette;

    let colorType;
    let bitDepth;
    let raw;
    let lineBytes;
    let bpp;

    if (palette) {
        colorType = COLOR_TYPE.PALETTE;
        bitDepth = bitDepthFor(palette.length);
        bpp = 1;

        const packed = packIndices(plan.indices, width, height, bitDepth);
        raw = packed.raw;
        lineBytes = packed.lineBytes;
    } else {
        const hasAlpha = imageHasAlpha(rgba, width * height);
        colorType = hasAlpha ? COLOR_TYPE.RGBA : COLOR_TYPE.RGB;
        bitDepth = 8;

        const built = buildTruecolorRaw(rgba, width, height, hasAlpha);
        raw = built.raw;
        lineBytes = built.lineBytes;
        bpp = built.channels;
    }

    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width);
    ihdrView.setUint32(4, height);
    ihdr[8] = bitDepth;
    ihdr[9] = colorType;
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace
    chunks.push(makeChunk('IHDR', ihdr));

    if (palette) {
        const plte = new Uint8Array(palette.length * 3);
        for (let i = 0; i < palette.length; i++) {
            plte[i * 3] = palette[i].r;
            plte[i * 3 + 1] = palette[i].g;
            plte[i * 3 + 2] = palette[i].b;
        }
        chunks.push(makeChunk('PLTE', plte));

        // tRNS may stop after the last non-opaque entry; the palette was sorted by
        // ascending alpha so those are all at the front.
        let lastNonOpaque = -1;
        for (let i = 0; i < palette.length; i++) {
            if (palette[i].a !== 255) lastNonOpaque = i;
        }

        if (lastNonOpaque >= 0) {
            const trns = new Uint8Array(lastNonOpaque + 1);
            for (let i = 0; i <= lastNonOpaque; i++) trns[i] = palette[i].a;
            chunks.push(makeChunk('tRNS', trns));
        }
    }

    // Palette indices are labels, not a continuous signal, so predictors mostly add
    // entropy there; truecolour data is where filtering pays off.
    const filters = palette ? [0] : [0, 1, 2, 3, 4];
    const filtered = filterScanlines(raw, height, lineBytes, bpp, filters);

    chunks.push(makeChunk('IDAT', deflate(filtered)));
    chunks.push(makeChunk('IEND', new Uint8Array(0)));

    return {
        data: concat(chunks),
        colorType: colorType,
        bitDepth: bitDepth,
        paletteSize: palette ? palette.length : 0,
        quantized: !!plan.quantized
    };
}

export default { encodePng, COLOR_TYPE };
