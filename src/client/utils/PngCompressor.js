/**
 * PngCompressor - real PNG compression.
 *
 * Previously this delegated to browser-image-compression, which re-encodes
 * through a canvas. That cannot compress a PNG: per the HTML spec the `quality`
 * argument of toBlob/toDataURL applies only to lossy formats (image/jpeg,
 * image/webp) and is ignored for image/png, so the quality setting did nothing
 * and the canvas round-trip could even produce a larger file.
 *
 * The encoder here does what pngquant and optipng do:
 *   - index the image onto a palette (exactly when it already fits one, by
 *     median cut with Floyd-Steinberg dithering otherwise),
 *   - drop to 1/2/4-bit samples when the palette is small enough,
 *   - pick the best filter per scanline for truecolour data,
 *   - deflate at maximum level.
 *
 * It also never returns a file larger than the alternatives it considered.
 */

import pako from 'pako';
import { encodePng } from './png/PngEncoder.js';

const deflate = buf => pako.deflate(buf, { level: 9 });

/**
 * Map the 0-1 quality setting onto a palette budget.
 * At the top of the range nothing is thrown away at all.
 */
function planFromQuality(quality) {
    const q = Math.max(0, Math.min(1, typeof quality === 'number' ? quality : 0.8));

    if (q >= 0.95) return { quantize: false };

    return {
        quantize: true,
        maxColors: Math.max(2, Math.min(256, Math.round(16 + q * 240)))
    };
}

function isCanvas(value) {
    return !!value && typeof value.getContext === 'function';
}

function isImageDataLike(value) {
    return !!value && value.data && typeof value.width === 'number' &&
           typeof value.height === 'number' && !isCanvas(value);
}

function readCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: imageData.data, width: canvas.width, height: canvas.height };
}

function drawableToImageData(source, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);

    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

async function decodeBlob(blob) {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        try {
            return drawableToImageData(bitmap, bitmap.width, bitmap.height);
        } finally {
            if (bitmap.close) bitmap.close();
        }
    }

    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('Failed to decode image'));
            el.src = url;
        });
        return drawableToImageData(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Normalise any supported input into raw RGBA pixels.
 * Returns the source bytes too when the caller handed us an encoded file, so the
 * result can be compared against what they already had.
 */
async function toImageData(input) {
    if (isCanvas(input)) {
        return { image: readCanvas(input), originalBytes: null };
    }

    if (isImageDataLike(input)) {
        return {
            image: { data: input.data, width: input.width, height: input.height },
            originalBytes: null
        };
    }

    if (typeof Blob !== 'undefined' && input instanceof Blob) {
        const bytes = new Uint8Array(await input.arrayBuffer());
        return { image: await decodeBlob(input), originalBytes: bytes };
    }

    if (input instanceof Uint8Array || input instanceof ArrayBuffer) {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        const blob = new Blob([bytes], { type: 'image/png' });
        return { image: await decodeBlob(blob), originalBytes: bytes };
    }

    if (input && typeof input.width === 'number' && typeof input.height === 'number') {
        // HTMLImageElement / ImageBitmap
        const w = input.naturalWidth || input.width;
        const h = input.naturalHeight || input.height;
        return { image: drawableToImageData(input, w, h), originalBytes: null };
    }

    throw new Error('Unsupported input type for PNG compression');
}

function canvasToBytes(canvas) {
    return new Promise(resolve => {
        if (typeof canvas.toBlob !== 'function') {
            resolve(null);
            return;
        }
        canvas.toBlob(blob => {
            if (!blob) {
                resolve(null);
                return;
            }
            blob.arrayBuffer()
                .then(buf => resolve(new Uint8Array(buf)))
                .catch(() => resolve(null));
        }, 'image/png');
    });
}

/**
 * Compress a PNG.
 *
 * @param {File|Blob|Uint8Array|ImageData|HTMLCanvasElement|HTMLImageElement} input
 * @param {string} fileName - retained for API compatibility; unused
 * @param {Object} options
 * @param {number} [options.quality=0.8] - 0-1; >=0.95 disables quantization
 * @param {boolean} [options.dither=true] - Floyd-Steinberg when quantizing
 * @param {boolean} [options.compareLossless=true] - also encode losslessly and
 *        keep whichever is smaller; costs a second encode
 * @param {boolean} [options.stripMetadata] - always effectively on; the encoder
 *        emits no ancillary chunks, so nothing survives re-encoding
 * @returns {Promise<Uint8Array>} the compressed PNG
 */
export async function compressPng(input, fileName, options = {}) {
    return (await compressPngDetailed(input, fileName, options)).data;
}

/**
 * As compressPng, but also reports what the encoder chose. Useful for UI that
 * wants to show why a file did or did not shrink.
 *
 * @returns {Promise<{data: Uint8Array, colorType: number, bitDepth: number,
 *                    paletteSize: number, quantized: boolean, usedOriginal: boolean}>}
 */
export async function compressPngDetailed(input, fileName, options = {}) {
    const { image, originalBytes } = await toImageData(input);

    const plan = planFromQuality(options.quality);
    const result = encodePng(image, {
        deflate,
        quantize: plan.quantize,
        maxColors: plan.maxColors,
        dither: options.dither !== false,
        compareLossless: options.compareLossless !== false
    });

    let best = result.data;
    let usedOriginal = false;

    // Compressing must never inflate. If the caller gave us an encoded file that
    // was already smaller, hand it straight back.
    if (originalBytes && originalBytes.length && originalBytes.length <= best.length) {
        best = originalBytes;
        usedOriginal = true;
    }

    // For a canvas there are no original bytes, so compare against what the
    // browser itself would have written.
    if (!originalBytes && options.compareNative !== false && isCanvas(input)) {
        const native = await canvasToBytes(input);
        if (native && native.length < best.length) {
            best = native;
            usedOriginal = true;
        }
    }

    return {
        data: best,
        colorType: result.colorType,
        bitDepth: result.bitDepth,
        paletteSize: result.paletteSize,
        quantized: result.quantized && !usedOriginal,
        usedOriginal: usedOriginal
    };
}

/**
 * Compress a PNG from a canvas element.
 *
 * @param {HTMLCanvasElement} canvas - Source canvas
 * @param {string} fileName - retained for API compatibility; unused
 * @param {Object} options - see compressPng
 * @returns {Promise<Uint8Array>} Compressed PNG data
 */
export async function compressPngFromCanvas(canvas, fileName, options = {}) {
    return compressPng(canvas, fileName, options);
}

/**
 * Get the size of compressed data in bytes
 *
 * @param {Uint8Array} data - Compressed PNG data
 * @returns {number} Size in bytes
 */
export function getCompressedSize(data) {
    return data ? data.byteLength : 0;
}

/**
 * Calculate compression ratio
 *
 * @param {number} originalSize - Original size in bytes
 * @param {number} compressedSize - Compressed size in bytes
 * @returns {number} Compression ratio (0-1, where higher means more saved)
 */
export function getCompressionRatio(originalSize, compressedSize) {
    if (originalSize === 0) return 0;
    return 1 - (compressedSize / originalSize);
}

export default {
    compressPng,
    compressPngDetailed,
    compressPngFromCanvas,
    getCompressedSize,
    getCompressionRatio
};
