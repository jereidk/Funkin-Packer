/**
 * PngWorker - runs the PNG encoder off the main thread.
 *
 * Encoding a 4096x4096 sheet is several seconds of tight loops. On the main
 * thread that blocks rendering and input for the whole duration, which is what
 * made the compressor feel like it was hanging.
 *
 * PngCompressor falls back to encoding inline if this worker cannot be created
 * or fails to start, so a bundling or path problem degrades to the old
 * behaviour instead of breaking compression outright.
 */

import pako from 'pako';
import { encodePng } from './PngEncoder.js';

const deflate = buf => pako.deflate(buf, { level: 9 });

self.onmessage = event => {
    const { id, image, options } = event.data || {};

    try {
        const result = encodePng(image, {
            deflate,
            quantize: options.quantize,
            maxColors: options.maxColors,
            dither: options.dither,
            compareLossless: options.compareLossless
        });

        // The encoder owns this buffer, so hand it over instead of copying it back
        self.postMessage({ id: id, ok: true, result: result }, [result.data.buffer]);
    }
    catch (e) {
        self.postMessage({
            id: id,
            ok: false,
            // Flagged as an encoder failure so the caller does not retry inline
            // and pay for the same work twice.
            encodeError: true,
            error: (e && e.message) || String(e)
        });
    }
};
