/**
 * Regression suite for the PNG encoder and colour quantizer.
 *
 * Run with:  node test/png-encoder.test.mjs
 *
 * Decodes every file it produces back to RGBA using node's built-in zlib and
 * compares against the source pixels, so a malformed chunk, a bad CRC, a wrong
 * filter or a mis-packed bit depth fails loudly rather than shipping a PNG that
 * only some decoders accept. Exits non-zero on any failure.
 */

import zlib from 'zlib';
import { encodePng, COLOR_TYPE } from '../src/client/utils/png/PngEncoder.js';

const deflate = buf => new Uint8Array(zlib.deflateSync(Buffer.from(buf), { level: 9 }));

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

// ---------------------------------------------------------------- PNG decoder

function decodePng(bytes) {
    const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== sig[i]) throw new Error('bad signature');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    let ihdr = null, plte = null, trns = null;
    const idat = [];
    let sawIend = false;

    const crcTable = (() => {
        const t = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c;
        }
        return t;
    })();

    const crc32 = (buf, start, end) => {
        let c = -1;
        for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ -1) >>> 0;
    };

    while (pos < bytes.length) {
        const len = view.getUint32(pos);
        const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
        const dataStart = pos + 8;
        const stored = view.getUint32(dataStart + len);

        if (crc32(bytes, pos + 4, dataStart + len) !== stored) {
            throw new Error(`bad CRC on ${type}`);
        }

        const data = bytes.subarray(dataStart, dataStart + len);

        if (type === 'IHDR') {
            ihdr = {
                width: view.getUint32(dataStart),
                height: view.getUint32(dataStart + 4),
                bitDepth: data[8],
                colorType: data[9],
                compression: data[10],
                filter: data[11],
                interlace: data[12]
            };
        } else if (type === 'PLTE') plte = data;
        else if (type === 'tRNS') trns = data;
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') sawIend = true;

        pos = dataStart + len + 4;
    }

    if (!ihdr) throw new Error('missing IHDR');
    if (!sawIend) throw new Error('missing IEND');
    if (ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace !== 0) {
        throw new Error('unsupported IHDR flags');
    }

    const { width, height, bitDepth, colorType } = ihdr;

    const channels = colorType === COLOR_TYPE.RGBA ? 4
        : colorType === COLOR_TYPE.RGB ? 3
        : 1;

    const lineBytes = Math.ceil(width * channels * bitDepth / 8);
    const bpp = Math.max(1, Math.ceil(channels * bitDepth / 8));

    const inflated = new Uint8Array(zlib.inflateSync(Buffer.concat(idat.map(Buffer.from))));

    if (inflated.length !== (lineBytes + 1) * height) {
        throw new Error(`IDAT size ${inflated.length}, expected ${(lineBytes + 1) * height}`);
    }

    // undo filtering
    const raw = new Uint8Array(lineBytes * height);
    for (let y = 0; y < height; y++) {
        const filter = inflated[y * (lineBytes + 1)];
        const src = y * (lineBytes + 1) + 1;
        const dst = y * lineBytes;
        const prev = dst - lineBytes;

        for (let i = 0; i < lineBytes; i++) {
            const x = inflated[src + i];
            const a = i >= bpp ? raw[dst + i - bpp] : 0;
            const b = y > 0 ? raw[prev + i] : 0;
            const c = (y > 0 && i >= bpp) ? raw[prev + i - bpp] : 0;

            let v;
            switch (filter) {
                case 0: v = x; break;
                case 1: v = x + a; break;
                case 2: v = x + b; break;
                case 3: v = x + ((a + b) >> 1); break;
                case 4: {
                    const p = a + b - c;
                    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                    v = x + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c));
                    break;
                }
                default: throw new Error(`bad filter type ${filter} on row ${y}`);
            }
            raw[dst + i] = v & 0xFF;
        }
    }

    // expand to RGBA
    const out = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;

            if (colorType === COLOR_TYPE.PALETTE) {
                if (!plte) throw new Error('palette image without PLTE');
                const perByte = 8 / bitDepth;
                const mask = (1 << bitDepth) - 1;
                let index;
                if (bitDepth === 8) {
                    index = raw[y * lineBytes + x];
                } else {
                    const byte = raw[y * lineBytes + Math.floor(x / perByte)];
                    const shift = 8 - bitDepth * ((x % perByte) + 1);
                    index = (byte >> shift) & mask;
                }
                if (index * 3 + 2 >= plte.length) throw new Error(`palette index ${index} out of range`);
                out[o] = plte[index * 3];
                out[o + 1] = plte[index * 3 + 1];
                out[o + 2] = plte[index * 3 + 2];
                out[o + 3] = (trns && index < trns.length) ? trns[index] : 255;
            } else {
                const s = y * lineBytes + x * channels;
                out[o] = raw[s];
                out[o + 1] = raw[s + 1];
                out[o + 2] = raw[s + 2];
                out[o + 3] = channels === 4 ? raw[s + 3] : 255;
            }
        }
    }

    return { width, height, bitDepth, colorType, data: out, paletteSize: plte ? plte.length / 3 : 0 };
}

// ------------------------------------------------------------------ image gen

function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function makeImage(width, height, fn) {
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = fn(x, y);
            const p = (y * width + x) * 4;
            data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = a;
        }
    }
    return { data, width, height };
}

// ------------------------------------------------------------------- checking

function check(label, image, options, expect = {}) {
    runs++;
    let encoded;
    try {
        encoded = encodePng(image, { deflate, ...options });
    } catch (e) {
        return fail(label, `encode threw: ${e.message}`);
    }

    let decoded;
    try {
        decoded = decodePng(encoded.data);
    } catch (e) {
        return fail(label, `decode threw: ${e.message}`);
    }

    if (decoded.width !== image.width || decoded.height !== image.height) {
        return fail(label, `dims ${decoded.width}x${decoded.height} != ${image.width}x${image.height}`);
    }
    if (expect.colorType !== undefined && decoded.colorType !== expect.colorType) {
        return fail(label, `colorType ${decoded.colorType}, expected ${expect.colorType}`);
    }
    if (expect.bitDepth !== undefined && decoded.bitDepth !== expect.bitDepth) {
        return fail(label, `bitDepth ${decoded.bitDepth}, expected ${expect.bitDepth}`);
    }

    // pixel comparison
    let maxErr = 0, transparencyBroken = 0;
    for (let i = 0; i < image.width * image.height; i++) {
        const p = i * 4;
        const srcA = image.data[p + 3];
        const dstA = decoded.data[p + 3];

        // A fully transparent pixel must stay fully transparent - anything else
        // shows up as a halo around every sprite in the atlas.
        if (srcA === 0 && dstA !== 0) transparencyBroken++;
        if (srcA === 255 && dstA !== 255) transparencyBroken++;

        if (srcA === 0) continue;

        for (let c = 0; c < 4; c++) {
            const d = Math.abs(image.data[p + c] - decoded.data[p + c]);
            if (d > maxErr) maxErr = d;
        }
    }

    if (transparencyBroken) {
        return fail(label, `${transparencyBroken} pixels changed full transparency/opacity`);
    }

    const tolerance = expect.tolerance !== undefined ? expect.tolerance : 0;
    if (maxErr > tolerance) {
        return fail(label, `max channel error ${maxErr} > tolerance ${tolerance}`);
    }

    return { encoded, decoded };
}

// ---------------------------------------------------------------------- cases

console.log('=== lossless round-trip ===');

// flat-shaded sprite: few colours, must go indexed with no loss
check('2 colours -> 1bpp palette',
    makeImage(32, 32, (x, y) => (x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]),
    {}, { colorType: COLOR_TYPE.PALETTE, bitDepth: 1, tolerance: 0 });

check('4 colours -> 2bpp palette',
    makeImage(16, 16, (x, y) => [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0]][(x + y * 3) % 4]),
    {}, { colorType: COLOR_TYPE.PALETTE, bitDepth: 2, tolerance: 0 });

check('12 colours -> 4bpp palette',
    makeImage(24, 24, (x, y) => { const i = (x * y) % 12; return [i * 20, 255 - i * 15, i * 8, 255]; }),
    {}, { colorType: COLOR_TYPE.PALETTE, bitDepth: 4, tolerance: 0 });

check('200 colours -> 8bpp palette',
    makeImage(40, 40, (x, y) => { const i = (x + y * 40) % 200; return [i, (i * 7) % 256, (i * 13) % 256, 255]; }),
    {}, { colorType: COLOR_TYPE.PALETTE, bitDepth: 8, tolerance: 0 });

// truecolour: too many colours to index, lossless requested
const photo = makeImage(64, 64, (x, y) => [x * 4 % 256, y * 4 % 256, (x * y) % 256, 255]);
check('opaque gradient -> RGB', photo, { quantize: false }, { colorType: COLOR_TYPE.RGB, tolerance: 0 });

const photoAlpha = makeImage(64, 64, (x, y) => [x * 4 % 256, y * 4 % 256, (x * y) % 256, (x * 3) % 256]);
check('gradient + alpha -> RGBA', photoAlpha, { quantize: false }, { colorType: COLOR_TYPE.RGBA, tolerance: 0 });

console.log('=== quantized ===');

// A smooth gradient is the case where quantizing LOSES: dithering injects noise
// that deflates worse than the filtered truecolour original. The encoder must
// notice and ship the lossless version rather than a bigger, worse file.
const losslessGradient = encodePng(photo, { deflate, quantize: false }).data.length;

for (const [label, opts] of [
    ['gradient, quantize allowed, no dither', { maxColors: 256, dither: false }],
    ['gradient, quantize allowed, dither', { maxColors: 256, dither: true }],
    ['gradient, quantize allowed, 16 colours', { maxColors: 16 }]
]) {
    runs++;
    const enc = encodePng(photo, { deflate, ...opts });
    if (enc.data.length > losslessGradient) {
        fail(label, `${enc.data.length} B is larger than the lossless ${losslessGradient} B`);
    }
}

// A clustered-colour image is where quantizing WINS: many distinct values, but
// concentrated around a handful of hues.
const clustered = makeImage(96, 96, (x, y) => {
    const r2 = rng(x * 131 + y * 17);
    const base = [[200, 30, 30], [30, 200, 60], [40, 60, 210], [230, 210, 60], [120, 120, 120]][(Math.floor(x / 20) + Math.floor(y / 20)) % 5];
    const jitter = () => Math.round((r2() - 0.5) * 10);
    return [
        Math.max(0, Math.min(255, base[0] + jitter())),
        Math.max(0, Math.min(255, base[1] + jitter())),
        Math.max(0, Math.min(255, base[2] + jitter())),
        255
    ];
});

check('clustered colours quantize to palette', clustered, { maxColors: 256 },
    { colorType: COLOR_TYPE.PALETTE, tolerance: 40 });

runs++;
{
    const lossless = encodePng(clustered, { deflate, quantize: false }).data.length;
    const reduced = encodePng(clustered, { deflate, maxColors: 256 }).data.length;
    if (reduced >= lossless) {
        fail('clustered quantize gain', `quantized ${reduced} B did not beat lossless ${lossless} B`);
    }
}

console.log('=== edge cases ===');

check('1x1 opaque', makeImage(1, 1, () => [10, 20, 30, 255]), {}, { tolerance: 0 });
check('1x1 transparent', makeImage(1, 1, () => [0, 0, 0, 0]), {}, { tolerance: 0 });
check('fully transparent 16x16', makeImage(16, 16, () => [0, 0, 0, 0]), {}, { tolerance: 0 });
check('single row', makeImage(64, 1, x => [x * 3 % 256, 0, 0, 255]), {}, { tolerance: 0 });
check('single column', makeImage(1, 64, (x, y) => [0, y * 3 % 256, 0, 255]), {}, { tolerance: 0 });
check('odd width 4bpp', makeImage(7, 5, (x, y) => [[0, 0, 0, 255], [255, 255, 255, 255], [255, 0, 0, 255]][(x + y) % 3]),
    {}, { bitDepth: 2, tolerance: 0 });
check('odd width 1bpp', makeImage(13, 3, x => x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]),
    {}, { bitDepth: 1, tolerance: 0 });
check('semi-transparent palette',
    makeImage(20, 20, (x, y) => [255, 0, 0, (x * 12) % 256]), {}, { tolerance: 0 });

// invalid input must be rejected, not silently produce a broken file
runs++;
try {
    encodePng({ data: new Uint8Array(10), width: 100, height: 100 }, { deflate });
    fail('short buffer', 'expected a throw');
} catch (e) { /* expected */ }

runs++;
try {
    encodePng({ data: new Uint8Array(4), width: 0, height: 0 }, { deflate });
    fail('zero dims', 'expected a throw');
} catch (e) { /* expected */ }

runs++;
try {
    encodePng(makeImage(4, 4, () => [0, 0, 0, 255]), {});
    fail('missing deflate', 'expected a throw');
} catch (e) { /* expected */ }

console.log('=== sprite-atlas sized round trip ===');

const rnd = rng(7);
const atlas = makeImage(512, 512, (x, y) => {
    // blocks of flat colour with transparent gutters, like a packed sheet
    const cx = Math.floor(x / 64), cy = Math.floor(y / 64);
    if (x % 64 < 2 || y % 64 < 2) return [0, 0, 0, 0];
    const i = cx + cy * 8;
    return [(i * 31) % 256, (i * 57) % 256, (i * 97) % 256, 255];
});
const atlasRes = check('512x512 atlas lossless', atlas, {}, { colorType: COLOR_TYPE.PALETTE, tolerance: 0 });

console.log(`\n${runs - failures}/${runs} checks passed`);

// ------------------------------------------------------------------ size report

console.log('\n=== size vs unfiltered truecolour baseline ===');

function baseline(image) {
    // what a naive encoder emits: raw RGBA scanlines, filter 0, deflate
    const { data, width, height } = image;
    const raw = new Uint8Array((width * 4 + 1) * height);
    let o = 0;
    for (let y = 0; y < height; y++) {
        raw[o++] = 0;
        raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), o);
        o += width * 4;
    }
    return zlib.deflateSync(Buffer.from(raw), { level: 9 }).length;
}

// Closer to a real character sheet: shaded blobs with antialiased alpha edges on
// a transparent background - the hard case, since soft edges create many colours.
const aaRnd = rng(3);
const blobs = Array.from({ length: 24 }, () => ({
    cx: aaRnd() * 448 + 32, cy: aaRnd() * 448 + 32, r: 12 + aaRnd() * 26,
    col: [aaRnd() * 255, aaRnd() * 255, aaRnd() * 255]
}));

const character = makeImage(512, 512, (x, y) => {
    let best = null, bestD = Infinity;
    for (const b of blobs) {
        const d = Math.hypot(x - b.cx, y - b.cy) - b.r;
        if (d < bestD) { bestD = d; best = b; }
    }
    if (bestD > 1) return [0, 0, 0, 0];
    const alpha = bestD < 0 ? 255 : Math.round(255 * (1 - bestD));
    const shade = 0.65 + 0.35 * (1 - Math.min(1, Math.abs(bestD) / 20));
    return [
        Math.round(best.col[0] * shade),
        Math.round(best.col[1] * shade),
        Math.round(best.col[2] * shade),
        alpha
    ];
});

for (const [label, img, opts] of [
    ['512x512 flat sprite atlas', atlas, {}],
    ['512x512 antialiased sheet (lossless)', character, { quantize: false }],
    ['512x512 antialiased sheet (q=0.8)', character, { maxColors: 208 }],
    ['512x512 antialiased sheet (q=0.5)', character, { maxColors: 136 }],
    ['64x64 gradient (lossless)', photo, { quantize: false }],
    ['64x64 gradient (quantized)', photo, { maxColors: 256 }],
    ['64x64 gradient+alpha', photoAlpha, { quantize: false }]
]) {
    const base = baseline(img);
    const enc = encodePng(img, { deflate, ...opts });
    const pct = (enc.data.length / base * 100).toFixed(1);
    console.log(`  ${label.padEnd(30)} ${String(base).padStart(8)} B -> ${String(enc.data.length).padStart(8)} B  (${pct}%)  type=${enc.colorType} depth=${enc.bitDepth} pal=${enc.paletteSize}`);
}

process.exit(failures ? 1 : 0);
