/**
 * ColorQuantizer - median-cut RGBA quantization with optional Floyd-Steinberg
 * dithering, used to turn a truecolor atlas into a <=256 entry palette.
 *
 * This is the step that actually shrinks a PNG. A browser's canvas encoder only
 * ever writes 8-bit truecolor and ignores the `quality` argument entirely, so
 * without quantization there is nothing for "PNG quality" to control.
 *
 * Deliberately dependency-free so it can be exercised under plain node.
 */

// 5 bits per channel: the histogram merges near-identical colors before the cut,
// while representatives are still averaged from the full 8-bit values.
const CHANNEL_BITS = 5;
const SHIFT = 8 - CHANNEL_BITS;
const HIST_SIZE = 1 << (CHANNEL_BITS * 4);

const R_SHIFT = CHANNEL_BITS * 3;
const G_SHIFT = CHANNEL_BITS * 2;
const B_SHIFT = CHANNEL_BITS;

export const MAX_PALETTE = 256;

function histKey(r, g, b, a) {
    return ((r >> SHIFT) << R_SHIFT) |
           ((g >> SHIFT) << G_SHIFT) |
           ((b >> SHIFT) << B_SHIFT) |
            (a >> SHIFT);
}

/**
 * Perceptual RGBA distance. RGB error is weighted by luma and scaled down as the
 * pixels get more transparent (invisible color is not worth palette budget),
 * while alpha error is weighted up because it shows as a hard edge artifact.
 */
function colorDistance(r1, g1, b1, a1, r2, g2, b2, a2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const da = a1 - a2;
    const visibility = (a1 + a2) / 510;

    return (dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114) * visibility +
           da * da * 2;
}

/**
 * Collect the distinct (5-bit reduced) colors present in the image.
 * Fully transparent pixels are pulled out so they never consume palette slots
 * or bleed their meaningless RGB into a representative.
 */
function buildHistogram(rgba, pixelCount) {
    const counts = new Uint32Array(HIST_SIZE);
    const sumR = new Uint32Array(HIST_SIZE);
    const sumG = new Uint32Array(HIST_SIZE);
    const sumB = new Uint32Array(HIST_SIZE);
    const sumA = new Uint32Array(HIST_SIZE);

    let transparent = 0;

    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
        const a = rgba[p + 3];

        if (a === 0) {
            transparent++;
            continue;
        }

        const r = rgba[p];
        const g = rgba[p + 1];
        const b = rgba[p + 2];
        const key = histKey(r, g, b, a);

        counts[key]++;
        sumR[key] += r;
        sumG[key] += g;
        sumB[key] += b;
        sumA[key] += a;
    }

    const entries = [];

    for (let key = 0; key < HIST_SIZE; key++) {
        const count = counts[key];
        if (count === 0) continue;

        entries.push({
            r: sumR[key] / count,
            g: sumG[key] / count,
            b: sumB[key] / count,
            a: sumA[key] / count,
            count: count
        });
    }

    return { entries, transparent };
}

function boxBounds(entries) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0;
    let bMin = 255, bMax = 0, aMin = 255, aMax = 0;
    let count = 0;

    for (const e of entries) {
        if (e.r < rMin) rMin = e.r;
        if (e.r > rMax) rMax = e.r;
        if (e.g < gMin) gMin = e.g;
        if (e.g > gMax) gMax = e.g;
        if (e.b < bMin) bMin = e.b;
        if (e.b > bMax) bMax = e.b;
        if (e.a < aMin) aMin = e.a;
        if (e.a > aMax) aMax = e.a;
        count += e.count;
    }

    // Alpha spread is scaled up to match the distance metric, so a box that mixes
    // opaque and translucent pixels gets split before one that mixes hues.
    const ranges = [rMax - rMin, gMax - gMin, bMax - bMin, (aMax - aMin) * 1.5];
    let channel = 0;
    for (let i = 1; i < 4; i++) {
        if (ranges[i] > ranges[channel]) channel = i;
    }

    return { entries, count, channel, range: ranges[channel] };
}

function splitBox(box) {
    const key = ['r', 'g', 'b', 'a'][box.channel];
    const sorted = box.entries.slice().sort((x, y) => x[key] - y[key]);

    const half = box.count / 2;
    let acc = 0;
    let split = 0;

    for (; split < sorted.length - 1; split++) {
        acc += sorted[split].count;
        if (acc >= half) break;
    }

    // Both halves must be non-empty or the loop below never converges
    if (split >= sorted.length - 1) split = sorted.length - 2;

    return [
        boxBounds(sorted.slice(0, split + 1)),
        boxBounds(sorted.slice(split + 1))
    ];
}

function representative(box) {
    let r = 0, g = 0, b = 0, a = 0, total = 0;

    for (const e of box.entries) {
        r += e.r * e.count;
        g += e.g * e.count;
        b += e.b * e.count;
        a += e.a * e.count;
        total += e.count;
    }

    return {
        r: Math.round(r / total),
        g: Math.round(g / total),
        b: Math.round(b / total),
        a: Math.round(a / total)
    };
}

/**
 * Build a palette of at most `maxColors` entries via median cut.
 */
export function buildPalette(rgba, width, height, maxColors) {
    const pixelCount = width * height;
    const { entries, transparent } = buildHistogram(rgba, pixelCount);

    const reserved = transparent > 0 ? 1 : 0;
    const budget = Math.max(1, Math.min(maxColors, MAX_PALETTE) - reserved);

    let boxes = entries.length ? [boxBounds(entries)] : [];

    while (boxes.length < budget) {
        // Split whichever box covers the most colour volume for the most pixels;
        // splitting purely by population leaves wide gradients banded.
        let target = -1;
        let bestScore = 0;

        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.entries.length < 2 || box.range <= 0) continue;

            const score = box.range * box.count;
            if (score > bestScore) {
                bestScore = score;
                target = i;
            }
        }

        if (target < 0) break;

        const [left, right] = splitBox(boxes[target]);
        boxes.splice(target, 1, left, right);
    }

    const palette = boxes.map(representative);

    if (transparent > 0) palette.unshift({ r: 0, g: 0, b: 0, a: 0 });

    // Sort by ascending alpha so the tRNS chunk only has to cover the leading
    // non-opaque entries instead of the whole palette.
    palette.sort((x, y) => x.a - y.a);

    return palette;
}

/**
 * Map every pixel to its nearest palette entry.
 *
 * @returns {Uint8Array} one palette index per pixel
 */
export function mapToPalette(rgba, width, height, palette, dither) {
    const pixelCount = width * height;
    const indices = new Uint8Array(pixelCount);
    const size = palette.length;

    const palR = new Uint8Array(size);
    const palG = new Uint8Array(size);
    const palB = new Uint8Array(size);
    const palA = new Uint8Array(size);

    let transparentIndex = -1;

    for (let i = 0; i < size; i++) {
        palR[i] = palette[i].r;
        palG[i] = palette[i].g;
        palB[i] = palette[i].b;
        palA[i] = palette[i].a;
        if (palA[i] === 0 && transparentIndex < 0) transparentIndex = i;
    }

    // Nearest-entry results are memoised per reduced colour; without this the
    // search is pixelCount * paletteSize and dominates a large atlas.
    const cache = new Int16Array(HIST_SIZE).fill(-1);

    const nearest = (r, g, b, a) => {
        const key = histKey(r, g, b, a);
        const hit = cache[key];
        if (hit >= 0) return hit;

        let best = 0;
        let bestDist = Infinity;

        for (let i = 0; i < size; i++) {
            const dist = colorDistance(r, g, b, a, palR[i], palG[i], palB[i], palA[i]);
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
                if (dist === 0) break;
            }
        }

        cache[key] = best;
        return best;
    };

    if (!dither) {
        for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
            const a = rgba[p + 3];
            indices[i] = (a === 0 && transparentIndex >= 0)
                ? transparentIndex
                : nearest(rgba[p], rgba[p + 1], rgba[p + 2], a);
        }
        return indices;
    }

    // Floyd-Steinberg: only the current and next row of error are kept, so memory
    // stays at O(width) instead of a full float copy of the image.
    const stride = width * 4;
    let errCurr = new Float32Array(stride);
    let errNext = new Float32Array(stride);

    const clamp = v => v < 0 ? 0 : (v > 255 ? 255 : v);

    for (let y = 0; y < height; y++) {
        errNext.fill(0);

        for (let x = 0; x < width; x++) {
            const p = (y * width + x) * 4;
            const e = x * 4;

            const a0 = rgba[p + 3];

            if (a0 === 0 && transparentIndex >= 0) {
                indices[y * width + x] = transparentIndex;
                continue;
            }

            const r = clamp(Math.round(rgba[p] + errCurr[e]));
            const g = clamp(Math.round(rgba[p + 1] + errCurr[e + 1]));
            const b = clamp(Math.round(rgba[p + 2] + errCurr[e + 2]));
            const a = clamp(Math.round(a0 + errCurr[e + 3]));

            const idx = nearest(r, g, b, a);
            indices[y * width + x] = idx;

            const dr = r - palR[idx];
            const dg = g - palG[idx];
            const db = b - palB[idx];
            const da = a - palA[idx];

            if (x + 1 < width) {
                const n = e + 4;
                errCurr[n]     += dr * 7 / 16;
                errCurr[n + 1] += dg * 7 / 16;
                errCurr[n + 2] += db * 7 / 16;
                errCurr[n + 3] += da * 7 / 16;
            }
            if (x > 0) {
                const n = e - 4;
                errNext[n]     += dr * 3 / 16;
                errNext[n + 1] += dg * 3 / 16;
                errNext[n + 2] += db * 3 / 16;
                errNext[n + 3] += da * 3 / 16;
            }
            errNext[e]     += dr * 5 / 16;
            errNext[e + 1] += dg * 5 / 16;
            errNext[e + 2] += db * 5 / 16;
            errNext[e + 3] += da * 5 / 16;

            if (x + 1 < width) {
                const n = e + 4;
                errNext[n]     += dr / 16;
                errNext[n + 1] += dg / 16;
                errNext[n + 2] += db / 16;
                errNext[n + 3] += da / 16;
            }
        }

        const swap = errCurr;
        errCurr = errNext;
        errNext = swap;
    }

    return indices;
}

/**
 * Build a palette from the image's exact colours, or null if there are more than
 * `limit` of them.
 *
 * This is what makes the indexed path genuinely lossless. Going through
 * buildPalette instead would quietly lose precision, because its histogram merges
 * colours that share a 5-bit bucket - 0x00 and 0x03 land in the same one - and
 * the representative comes back as their average.
 *
 * @returns {{palette: Array, indices: Uint8Array}|null}
 */
export function extractExactPalette(rgba, width, height, limit) {
    const pixelCount = width * height;
    const lookup = new Map();
    const palette = [];

    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
        const a = rgba[p + 3];
        // Every fully transparent pixel collapses onto a single entry
        const key = a === 0
            ? -1
            : (((rgba[p] << 24) | (rgba[p + 1] << 16) | (rgba[p + 2] << 8) | a) >>> 0);

        if (lookup.has(key)) continue;
        if (palette.length >= limit) return null;

        lookup.set(key, palette.length);
        palette.push(a === 0
            ? { r: 0, g: 0, b: 0, a: 0 }
            : { r: rgba[p], g: rgba[p + 1], b: rgba[p + 2], a: a });
    }

    // Sort by ascending alpha so tRNS only needs to cover the leading entries,
    // then rewrite the lookup through the resulting permutation.
    const order = palette.map((_, i) => i).sort((x, y) => palette[x].a - palette[y].a);
    const remap = new Array(palette.length);
    for (let newIndex = 0; newIndex < order.length; newIndex++) {
        remap[order[newIndex]] = newIndex;
    }

    const sorted = order.map(i => palette[i]);
    for (const [key, value] of lookup) lookup.set(key, remap[value]);

    const indices = new Uint8Array(pixelCount);

    for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
        const a = rgba[p + 3];
        const key = a === 0
            ? -1
            : (((rgba[p] << 24) | (rgba[p + 1] << 16) | (rgba[p + 2] << 8) | a) >>> 0);
        indices[i] = lookup.get(key);
    }

    return { palette: sorted, indices };
}

export default { buildPalette, mapToPalette, extractExactPalette, MAX_PALETTE };
