/**
 * AdvancedSmartSizeSolver - Multi-algorithm bin packing for optimal atlas dimensions
 * Implements: MaxRects variants, Guillotine, Shelf, Skyline algorithms
 * Selects the best packing based on efficiency and atlas dimensions
 *
 * Coordinate convention used throughout this file:
 *  - A packer is constructed with the INNER bin size (atlas size minus borderPadding
 *    on both sides) and works entirely in inner coordinates.
 *  - `padding` is the per-sprite gap. A packer reserves `padding` on every side of a
 *    sprite (so neighbours end up `padding * 2` apart) and returns the sprite rect,
 *    not the padded box.
 *  - insert() returns null when the sprite does not fit. Every packer must honour
 *    this; a packer that always succeeds makes the solver report impossible sizes.
 */

const MAX_SIZE_LIMIT = 4096;

// How many times GuillotinePacker re-scans its free list looking for merges.
const MERGE_PASSES = 2;

// ============================================
// MAXRECTS PACKER - All Variants
// ============================================
class MaxRectsPacker {
    constructor(width, height, padding = 0) {
        this.binWidth = width;
        this.binHeight = height;
        this.padding = padding;
        this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
        this.usedRects = [];
        this.spriteArea = 0;
    }

    clone() {
        const copy = new MaxRectsPacker(this.binWidth, this.binHeight, this.padding);
        copy.freeRects = this.freeRects.map(r => ({ ...r }));
        copy.usedRects = this.usedRects.map(r => ({ ...r }));
        copy.spriteArea = this.spriteArea;
        return copy;
    }

    insert(width, height, method = 'BestShortSideFit', allowRotation = false) {
        // Reserve the sprite gap on every side; the packer places padded boxes and
        // reports the sprite rect inset back out of it.
        const paddedW = width + this.padding * 2;
        const paddedH = height + this.padding * 2;

        let bestRect = null;
        let bestScore = { score1: Infinity, score2: Infinity };

        for (let i = 0; i < this.freeRects.length; i++) {
            const free = this.freeRects[i];

            if (free.w >= paddedW && free.h >= paddedH) {
                const result = this.scoreRect(free, paddedW, paddedH, method);
                if (this.isBetter(result, bestScore)) {
                    bestScore = result;
                    bestRect = { x: free.x, y: free.y, w: paddedW, h: paddedH, rotated: false };
                }
            }

            // Try rotation only when the caller allows it - the packer must model the
            // same constraints as the real packer or the size estimate is meaningless.
            if (allowRotation && paddedW !== paddedH && free.w >= paddedH && free.h >= paddedW) {
                const result = this.scoreRect(free, paddedH, paddedW, method);
                if (this.isBetter(result, bestScore)) {
                    bestScore = result;
                    bestRect = { x: free.x, y: free.y, w: paddedH, h: paddedW, rotated: true };
                }
            }
        }

        if (!bestRect) return null;

        this.placeRect(bestRect);
        this.spriteArea += width * height;

        return {
            x: bestRect.x + this.padding,
            y: bestRect.y + this.padding,
            w: bestRect.rotated ? height : width,
            h: bestRect.rotated ? width : height,
            rotated: bestRect.rotated
        };
    }

    scoreRect(free, width, height, method) {
        const leftoverH = free.w - width;
        const leftoverV = free.h - height;
        const shortSide = Math.min(leftoverH, leftoverV);
        const longSide = Math.max(leftoverH, leftoverV);
        const area = free.w * free.h;

        switch (method) {
            case 'BestShortSideFit':
                return { score1: shortSide, score2: longSide };
            case 'BestLongSideFit':
                return { score1: longSide, score2: shortSide };
            case 'BestAreaFit':
                return { score1: area - width * height, score2: shortSide };
            case 'BottomLeftRule':
                return { score1: free.y + height, score2: free.x };
            case 'ContactPoint':
                // higher contact is better, so negate to keep "lower score wins"
                return { score1: -this.contactScore(free.x, free.y, width, height), score2: free.y };
            default:
                return { score1: shortSide, score2: longSide };
        }
    }

    isBetter(newScore, bestScore) {
        if (newScore.score1 < bestScore.score1) return true;
        if (newScore.score1 === bestScore.score1 && newScore.score2 < bestScore.score2) return true;
        return false;
    }

    contactScore(x, y, width, height) {
        let score = 0;
        if (x === 0 || x + width === this.binWidth) score += height;
        if (y === 0 || y + height === this.binHeight) score += width;

        for (const rect of this.usedRects) {
            if (rect.x === x + width || rect.x + rect.w === x)
                score += this.intervalOverlap(rect.y, rect.y + rect.h, y, y + height);
            if (rect.y === y + height || rect.y + rect.h === y)
                score += this.intervalOverlap(rect.x, rect.x + rect.w, x, x + width);
        }
        return score;
    }

    intervalOverlap(aStart, aEnd, bStart, bEnd) {
        if (aEnd < bStart || bEnd < aStart) return 0;
        return Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
    }

    placeRect(rect) {
        const prRight = rect.x + rect.w;
        const prBottom = rect.y + rect.h;

        // Split every free rect that intersects the placed rect, including the one
        // chosen for placement. The overlapping area is simply never re-emitted.
        //
        // Rects that did NOT intersect are carried over untouched. They were already
        // mutually non-contained, so only the freshly created ones need pruning -
        // sweeping the whole list every insert made this O(f^2) per sprite and
        // dominated the solver's runtime (641ms for a single 1000-sprite pack).
        const kept = [];
        const created = [];

        for (const free of this.freeRects) {
            const frRight = free.x + free.w;
            const frBottom = free.y + free.h;

            if (rect.x >= frRight || prRight <= free.x ||
                rect.y >= frBottom || prBottom <= free.y) {
                kept.push(free);
                continue;
            }

            if (free.x < rect.x) {
                created.push({ x: free.x, y: free.y, w: rect.x - free.x, h: free.h });
            }
            if (frRight > prRight) {
                created.push({ x: prRight, y: free.y, w: frRight - prRight, h: free.h });
            }
            if (free.y < rect.y) {
                created.push({ x: free.x, y: free.y, w: free.w, h: rect.y - free.y });
            }
            if (frBottom > prBottom) {
                created.push({ x: free.x, y: prBottom, w: free.w, h: frBottom - prBottom });
            }
        }

        this.pruneAgainst(created, kept);

        this.freeRects = kept.length ? kept.concat(created) : created;
        this.usedRects.push(rect);
    }

    /**
     * Drop contained rects: `created` against itself, then across `created`/`kept`.
     * Both arrays are mutated in place.
     */
    pruneAgainst(created, kept) {
        for (let i = created.length - 1; i >= 0; i--) {
            let removed = false;

            for (let j = created.length - 1; j > i; j--) {
                if (this.containsRect(created[i], created[j])) {
                    created.splice(j, 1);
                } else if (this.containsRect(created[j], created[i])) {
                    created.splice(i, 1);
                    removed = true;
                    break;
                }
            }

            if (removed) continue;

            for (let j = kept.length - 1; j >= 0; j--) {
                if (this.containsRect(kept[j], created[i])) {
                    created.splice(i, 1);
                    break;
                }
                if (this.containsRect(created[i], kept[j])) {
                    kept.splice(j, 1);
                }
            }
        }
    }

    containsRect(a, b) {
        return a.x <= b.x && a.y <= b.y &&
               a.x + a.w >= b.x + b.w &&
               a.y + a.h >= b.y + b.h;
    }

    occupancy() {
        return this.spriteArea / (this.binWidth * this.binHeight);
    }
}

// ============================================
// GUILLOTINE PACKER
// ============================================
class GuillotinePacker {
    constructor(width, height, padding = 0) {
        this.binWidth = width;
        this.binHeight = height;
        this.padding = padding;
        this.freeRects = [{ x: 0, y: 0, w: width, h: height }];
        this.usedRects = [];
        this.spriteArea = 0;
        this.splitMethod = 'BestShortSideFit';
    }

    insert(width, height) {
        const paddedW = width + this.padding * 2;
        const paddedH = height + this.padding * 2;

        let bestIndex = -1;
        let bestRect = null;
        let bestScore = Infinity;

        for (let i = 0; i < this.freeRects.length; i++) {
            const rect = this.freeRects[i];
            if (rect.w >= paddedW && rect.h >= paddedH) {
                const score = this.score(rect, paddedW, paddedH);
                if (score < bestScore) {
                    bestScore = score;
                    bestIndex = i;
                    bestRect = { ...rect };
                }
            }
        }

        if (bestIndex === -1) return null;

        this.freeRects.splice(bestIndex, 1);

        const splitW = bestRect.w - paddedW;
        const splitH = bestRect.h - paddedH;

        // A guillotine split must produce DISJOINT free rects: exactly one of them
        // may span the full side, the other is clipped to the placed rect's extent.
        // Letting both span the full side overlaps them and stacks sprites.
        if (splitW > 0 && splitH > 0) {
            // Keep whichever leftover is larger as one full-span rect (Jylanki's
            // "split shorter leftover axis"). Cutting the other way strands the big
            // dimension in slivers and collapses occupancy to ~20%.
            const splitVertical = (this.splitMethod === 'BestShortSideFit')
                ? splitW >= splitH
                : splitW * bestRect.h > splitH * bestRect.w;

            if (splitVertical) {
                // Cut down the right edge: right piece keeps the full height,
                // bottom piece is clipped to the placed rect's width.
                this.freeRects.push({
                    x: bestRect.x + paddedW,
                    y: bestRect.y,
                    w: splitW,
                    h: bestRect.h
                });
                this.freeRects.push({
                    x: bestRect.x,
                    y: bestRect.y + paddedH,
                    w: paddedW,
                    h: splitH
                });
            } else {
                // Cut across the bottom edge: bottom piece keeps the full width,
                // right piece is clipped to the placed rect's height.
                this.freeRects.push({
                    x: bestRect.x,
                    y: bestRect.y + paddedH,
                    w: bestRect.w,
                    h: splitH
                });
                this.freeRects.push({
                    x: bestRect.x + paddedW,
                    y: bestRect.y,
                    w: splitW,
                    h: paddedH
                });
            }
        } else if (splitW > 0) {
            this.freeRects.push({
                x: bestRect.x + paddedW,
                y: bestRect.y,
                w: splitW,
                h: bestRect.h
            });
        } else if (splitH > 0) {
            this.freeRects.push({
                x: bestRect.x,
                y: bestRect.y + paddedH,
                w: bestRect.w,
                h: splitH
            });
        }

        this.mergeFreeRects();

        const placed = { x: bestRect.x + this.padding, y: bestRect.y + this.padding, w: width, h: height };
        this.usedRects.push(placed);
        this.spriteArea += width * height;
        return placed;
    }

    /**
     * Recombine free rects that share a full edge. Without this the guillotine cuts
     * shred the sheet into slivers that nothing fits into, which is why this packer
     * was bottoming out around 20-28% occupancy.
     */
    mergeFreeRects() {
        // Repeated passes let a rect absorb several neighbours, but the count is
        // capped: restarting the scan on every merge turns this into O(f^3) and it
        // becomes the dominant cost on large sheets for a marginal packing gain.
        for (let pass = 0; pass < MERGE_PASSES; pass++) {
            let merged = false;

            for (let i = 0; i < this.freeRects.length; i++) {
                const a = this.freeRects[i];

                for (let j = this.freeRects.length - 1; j > i; j--) {
                    const b = this.freeRects[j];
                    let joined = false;

                    if (a.w === b.w && a.x === b.x) {
                        if (a.y === b.y + b.h) { a.y = b.y; a.h += b.h; joined = true; }
                        else if (a.y + a.h === b.y) { a.h += b.h; joined = true; }
                    }
                    else if (a.h === b.h && a.y === b.y) {
                        if (a.x === b.x + b.w) { a.x = b.x; a.w += b.w; joined = true; }
                        else if (a.x + a.w === b.x) { a.w += b.w; joined = true; }
                    }

                    if (joined) {
                        this.freeRects.splice(j, 1);
                        merged = true;
                    }
                }
            }

            if (!merged) break;
        }
    }

    score(rect, width, height) {
        if (this.splitMethod === 'BestShortSideFit') {
            const leftoverH = rect.w - width;
            const leftoverV = rect.h - height;
            return Math.min(leftoverH, leftoverV);
        }
        return rect.w * rect.h - width * height;
    }

    occupancy() {
        return this.spriteArea / (this.binWidth * this.binHeight);
    }
}

// ============================================
// SHELF PACKER
// ============================================
class ShelfPacker {
    constructor(width, height, padding = 0) {
        this.binWidth = width;
        this.binHeight = height;
        this.padding = padding;
        this.shelves = [];
        this.usedRects = [];
        this.spriteArea = 0;
        this.currentY = 0;
    }

    insert(width, height) {
        const paddedW = width + this.padding * 2;
        const paddedH = height + this.padding * 2;

        if (paddedW > this.binWidth) return null;

        let bestShelfIndex = -1;
        let bestScore = Infinity;

        for (let i = 0; i < this.shelves.length; i++) {
            const shelf = this.shelves[i];
            if (shelf.height >= paddedH && shelf.usedWidth + paddedW <= this.binWidth) {
                const leftover = shelf.height - paddedH;
                if (leftover < bestScore) {
                    bestScore = leftover;
                    bestShelfIndex = i;
                }
            }
        }

        let shelf;
        if (bestShelfIndex === -1) {
            // Opening a new shelf must respect the bin height, otherwise the packer
            // never fails and the solver happily reports an over-limit atlas.
            if (this.currentY + paddedH > this.binHeight) return null;

            shelf = {
                height: paddedH,
                usedWidth: 0,
                y: this.currentY
            };
            this.shelves.push(shelf);
            this.currentY += paddedH;
        } else {
            shelf = this.shelves[bestShelfIndex];
        }

        const rect = {
            x: shelf.usedWidth + this.padding,
            y: shelf.y + this.padding,
            w: width,
            h: height
        };

        shelf.usedWidth += paddedW;
        this.usedRects.push(rect);
        this.spriteArea += width * height;
        return rect;
    }

    occupancy() {
        return this.spriteArea / (this.binWidth * this.binHeight);
    }

    getHeight() {
        if (this.shelves.length === 0) return 0;
        const lastShelf = this.shelves[this.shelves.length - 1];
        return lastShelf.y + lastShelf.height;
    }
}

// ============================================
// SKYLINE PACKER
// ============================================
class SkylinePacker {
    constructor(width, height, padding = 0) {
        this.binWidth = width;
        this.binHeight = height;
        this.padding = padding;
        this.skyline = [{ x: 0, y: 0, w: width }];
        this.usedRects = [];
        this.spriteArea = 0;
    }

    insert(width, height) {
        const paddedW = width + this.padding * 2;
        const paddedH = height + this.padding * 2;

        let bestIndex = -1;
        let bestX = 0;
        let bestY = Infinity;

        // Bottom-left rule: lowest resting y wins, ties broken by leftmost x.
        for (let i = 0; i < this.skyline.length; i++) {
            const y = this.fits(i, paddedW, paddedH);
            if (y === null) continue;

            const x = this.skyline[i].x;
            if (y < bestY || (y === bestY && x < bestX)) {
                bestY = y;
                bestX = x;
                bestIndex = i;
            }
        }

        if (bestIndex === -1) return null;

        this.addSkylineLevel(bestIndex, bestX, bestY, paddedW, paddedH);

        const rect = {
            x: bestX + this.padding,
            y: bestY + this.padding,
            w: width,
            h: height
        };

        this.usedRects.push(rect);
        this.spriteArea += width * height;
        return rect;
    }

    /**
     * Resting y for a paddedW x paddedH box starting at skyline node `index`,
     * or null when it runs past the right edge or the bin height.
     */
    fits(index, width, height) {
        const x = this.skyline[index].x;
        if (x + width > this.binWidth) return null;

        let y = 0;
        let remaining = width;
        let i = index;

        while (remaining > 0) {
            if (i >= this.skyline.length) return null;
            y = Math.max(y, this.skyline[i].y);
            if (y + height > this.binHeight) return null;
            remaining -= this.skyline[i].w;
            i++;
        }

        return y;
    }

    /**
     * Raise the skyline over [x, x+width). The new node must also CLIP the nodes it
     * covers - inserting without trimming them (the previous behaviour) let later
     * sprites resolve to stale low y values and land on top of existing ones.
     */
    addSkylineLevel(index, x, y, width, height) {
        this.skyline.splice(index, 0, { x: x, y: y + height, w: width });

        for (let i = index + 1; i < this.skyline.length; i++) {
            const node = this.skyline[i];
            const prev = this.skyline[i - 1];

            if (node.x >= prev.x + prev.w) break;

            const shrink = prev.x + prev.w - node.x;
            node.x += shrink;
            node.w -= shrink;

            if (node.w > 0) break;

            this.skyline.splice(i, 1);
            i--;
        }

        this.mergeSkyline();
    }

    mergeSkyline() {
        for (let i = 0; i < this.skyline.length - 1; i++) {
            if (this.skyline[i].y === this.skyline[i + 1].y) {
                this.skyline[i].w += this.skyline[i + 1].w;
                this.skyline.splice(i + 1, 1);
                i--;
            }
        }
    }

    occupancy() {
        return this.spriteArea / (this.binWidth * this.binHeight);
    }

    getHeight() {
        let maxY = 0;
        for (const node of this.skyline) {
            if (node.y > maxY) maxY = node.y;
        }
        return maxY;
    }
}

// ============================================
// MAIN SOLVER CLASS
// ============================================
class AdvancedSmartSizeSolver {
    // Algorithm identifiers
    static ALGORITHM = {
        BEST: 'best',
        MAXRECTS_BSSF: 'maxrects_bssf',
        MAXRECTS_BLSF: 'maxrects_blsf',
        MAXRECTS_BAF: 'maxrects_baf',
        MAXRECTS_BLR: 'maxrects_blr',
        MAXRECTS_CP: 'maxrects_cp',
        GUILLOTINE_BSSF: 'guillotine_bssf',
        GUILLOTINE_BAF: 'guillotine_baf',
        SHELF: 'shelf',
        SKYLINE: 'skyline'
    };

    static ALGORITHM_NAMES = {
        'best': 'Best Overall',
        'maxrects_bssf': 'MaxRects (Best Short Side)',
        'maxrects_blsf': 'MaxRects (Best Long Side)',
        'maxrects_baf': 'MaxRects (Best Area Fit)',
        'maxrects_blr': 'MaxRects (Bottom Left)',
        'maxrects_cp': 'MaxRects (Contact Point)',
        'guillotine_bssf': 'Guillotine (Short Side)',
        'guillotine_baf': 'Guillotine (Best Area)',
        'shelf': 'Shelf',
        'skyline': 'Skyline'
    };

    // Extreme aspect ratios pack "efficiently" but make poor atlases, so a mild
    // penalty steers ties toward square-ish sheets without overriding efficiency.
    static ASPECT_PENALTY = 0.15;

    // Stop searching once a packing is this good - further widths cannot help much.
    static GOOD_ENOUGH = 0.95;

    /**
     * Calculate optimal atlas dimensions using multiple algorithms
     * @param {Array} rects - Array of sprite rectangles with frame.w and frame.h
     * @param {Object} options - Solver options
     * @returns {Object} - { width, height, efficiency, algorithm, rects }
     */
    static calculateOptimalDimensions(rects, options = {}) {
        if (rects.length === 0) {
            return { width: 512, height: 512, efficiency: 0, algorithm: 'best', rects: [] };
        }

        const padding = options.padding || 0;
        const borderPadding = options.borderPadding || 0;
        const allowRotation = options.allowRotation || false;
        const powerOfTwo = options.powerOfTwo || false;
        const maxSizeLimit = options.disableMaxLimit ? 8192 : MAX_SIZE_LIMIT;
        const requestedAlgorithm = options.algorithm || AdvancedSmartSizeSolver.ALGORITHM.BEST;

        // map() already yields the index; the previous rects.indexOf(rect) lookup
        // made this O(n^2) before any packing even started.
        const sprites = rects.map((rect, index) => ({
            w: rect.frame.w,
            h: rect.frame.h,
            originalIndex: index
        }));

        // Sort by area (largest first) for better packing
        sprites.sort((a, b) => (b.w * b.h) - (a.w * a.h));

        let maxSpriteWidth = 0;
        let maxSpriteHeight = 0;
        let totalArea = 0;
        for (const s of sprites) {
            if (s.w > maxSpriteWidth) maxSpriteWidth = s.w;
            if (s.h > maxSpriteHeight) maxSpriteHeight = s.h;
            totalArea += s.w * s.h;
        }

        // A candidate width must fit the widest sprite plus its gap and the border,
        // otherwise every algorithm fails and the solver falls back to a bogus size.
        const overhead = padding * 2 + borderPadding * 2;
        const minWidth = maxSpriteWidth + overhead;
        const minHeight = maxSpriteHeight + overhead;

        const initialWidth = Math.max(minWidth, Math.ceil(Math.sqrt(totalArea)) + overhead);

        const algorithms = requestedAlgorithm === AdvancedSmartSizeSolver.ALGORITHM.BEST
            ? Object.values(AdvancedSmartSizeSolver.ALGORITHM).filter(a => a !== AdvancedSmartSizeSolver.ALGORITHM.BEST)
            : [requestedAlgorithm];

        const widths = this.generateCandidateWidths(
            initialWidth, minWidth, maxSpriteHeight, totalArea, maxSizeLimit, powerOfTwo
        );

        const packOptions = { padding, borderPadding, allowRotation, maxSizeLimit, powerOfTwo };

        let bestOverall = null;

        if (algorithms.length === 1) {
            bestOverall = this.searchWidths(sprites, widths, algorithms[0], packOptions);
        }
        else {
            // Two-phase search. Brute-forcing every width against every algorithm is
            // O(widths * algorithms * n^2) and took ~26s for 300 sprites; instead pick
            // the algorithm on a small probe set, then refine the width with it alone.
            const probeCount = sprites.length > 200 ? 3 : (sprites.length > 80 ? 4 : 6);
            const probes = this.pickSpread(widths, probeCount);

            let bestAlgorithm = algorithms[0];
            let bestProbe = null;

            for (const algo of algorithms) {
                const result = this.searchWidths(sprites, probes, algo, packOptions);
                if (result && (!bestProbe || this.isBetterResult(result, bestProbe))) {
                    bestProbe = result;
                    bestAlgorithm = algo;
                }
            }

            // Refining over every candidate width costs one full pack each, so on big
            // sheets narrow the list rather than letting the search grow with n.
            const refineWidths = sprites.length > 200
                ? this.pickSpread(widths, 10)
                : widths;

            const refined = this.searchWidths(sprites, refineWidths, bestAlgorithm, packOptions);
            bestOverall = (refined && (!bestProbe || this.isBetterResult(refined, bestProbe)))
                ? refined
                : bestProbe;
        }

        if (!bestOverall) {
            // Nothing fit within the size limit. Report the smallest sheet that at
            // least holds the largest sprite so the caller can surface a real error.
            const w = Math.min(minWidth, maxSizeLimit);
            const h = Math.min(minHeight, maxSizeLimit);
            return {
                width: w,
                height: h,
                efficiency: Math.min(1, totalArea / (w * h)),
                algorithm: requestedAlgorithm,
                rects: []
            };
        }

        // Power-of-two mode has a fixed, fully-enumerated candidate set (every
        // POT from 32 up to the size limit, tried exhaustively above) - there's
        // no off-grid gap for a binary search to close, and shrinking would
        // walk width down to a non-POT value, breaking the one guarantee this
        // mode exists to make.
        let winner = bestOverall;

        if (!powerOfTwo) {
            const shrunk = this.shrinkToFit(sprites, bestOverall, bestOverall.algorithm,
                { ...packOptions, minWidth, minHeight });
            if (shrunk.width * shrunk.height <= bestOverall.width * bestOverall.height) {
                winner = shrunk;
            }
        }

        return {
            width: winner.width,
            height: winner.height,
            efficiency: winner.efficiency,
            algorithm: winner.algorithm,
            rects: winner.rects
        };
    }

    /**
     * Run one algorithm across a list of candidate widths and keep the best result.
     */
    static searchWidths(sprites, widths, algorithm, options) {
        let best = null;

        for (const width of widths) {
            const result = this.packWithAlgorithm(sprites, width, options.maxSizeLimit, algorithm, options);

            if (!result.success) continue;

            result.algorithm = algorithm;

            if (!best || this.isBetterResult(result, best)) {
                best = result;
            }

            // Compare against the aspect-aware score, not raw efficiency. Widths are
            // tried ascending, and the narrowest sheet is often a perfectly "efficient"
            // single-column strip - stopping there would skip the square-ish option.
            if (this.score(best) >= AdvancedSmartSizeSolver.GOOD_ENOUGH) break;
        }

        return best;
    }

    /**
     * Evenly sample `count` entries from a sorted list, always keeping both ends.
     */
    static pickSpread(list, count) {
        if (list.length <= count) return list;

        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(list[Math.round(i * (list.length - 1) / (count - 1))]);
        }
        return Array.from(new Set(out));
    }

    static generateCandidateWidths(initialWidth, minWidth, maxSpriteHeight, totalArea, maxSizeLimit, powerOfTwo) {
        const widths = new Set();

        if (powerOfTwo) {
            // Only powers of two can survive the caller's rounding, so trying anything
            // else just wastes time and biases the choice toward a width that will be
            // rounded up anyway.
            for (let w = 32; w <= maxSizeLimit; w *= 2) {
                if (w >= minWidth) widths.add(w);
            }
            return Array.from(widths).sort((a, b) => a - b);
        }

        widths.add(minWidth);
        widths.add(initialWidth);
        widths.add(Math.ceil(Math.sqrt(totalArea)));
        if (maxSpriteHeight > 0) widths.add(Math.ceil(totalArea / maxSpriteHeight));

        for (let w = 64; w <= maxSizeLimit; w *= 2) {
            widths.add(w);
            widths.add(w - 32);
            widths.add(w + 32);
        }

        // Sample around the square-ish estimate, where the optimum usually sits
        const step = Math.max(32, Math.round(initialWidth / 16));
        for (let w = initialWidth - step * 4; w <= initialWidth + step * 4; w += step) {
            widths.add(w);
        }

        return Array.from(widths)
            .filter(w => w >= minWidth && w <= maxSizeLimit)
            .sort((a, b) => a - b);
    }

    static packWithAlgorithm(sprites, width, height, algorithm, options) {
        const padding = options.padding || 0;
        const borderPadding = options.borderPadding || 0;
        const allowRotation = options.allowRotation || false;
        const maxSizeLimit = options.maxSizeLimit || MAX_SIZE_LIMIT;

        // width/height are full atlas dimensions; the packer works inside the border.
        const innerWidth = width - borderPadding * 2;
        const innerHeight = height - borderPadding * 2;

        if (innerWidth <= 0 || innerHeight <= 0) return { success: false };

        let packer;
        let method = 'BestShortSideFit';

        switch (algorithm) {
            case AdvancedSmartSizeSolver.ALGORITHM.MAXRECTS_BSSF:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'BestShortSideFit';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.MAXRECTS_BLSF:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'BestLongSideFit';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.MAXRECTS_BAF:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'BestAreaFit';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.MAXRECTS_BLR:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'BottomLeftRule';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.MAXRECTS_CP:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'ContactPoint';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.GUILLOTINE_BSSF:
                packer = new GuillotinePacker(innerWidth, innerHeight, padding);
                packer.splitMethod = 'BestShortSideFit';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.GUILLOTINE_BAF:
                packer = new GuillotinePacker(innerWidth, innerHeight, padding);
                packer.splitMethod = 'BestAreaFit';
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.SHELF:
                packer = new ShelfPacker(innerWidth, innerHeight, padding);
                break;
            case AdvancedSmartSizeSolver.ALGORITHM.SKYLINE:
                packer = new SkylinePacker(innerWidth, innerHeight, padding);
                break;
            default:
                packer = new MaxRectsPacker(innerWidth, innerHeight, padding);
                method = 'BestShortSideFit';
        }

        const isMaxRects = packer instanceof MaxRectsPacker;
        const packed = [];
        let contentBottom = 0;

        for (const sprite of sprites) {
            const rect = isMaxRects
                ? packer.insert(sprite.w, sprite.h, method, allowRotation)
                : packer.insert(sprite.w, sprite.h);

            if (!rect) return { success: false };

            packed.push({
                ...sprite,
                x: rect.x + borderPadding,
                y: rect.y + borderPadding,
                w: rect.w,
                h: rect.h,
                rotated: !!rect.rotated
            });

            const bottom = rect.y + rect.h;
            if (bottom > contentBottom) contentBottom = bottom;
        }

        // Full atlas height: content plus one border on each side, plus the trailing
        // sprite gap so the bottom row keeps the same spacing as its neighbours.
        let usedHeight = contentBottom + padding + borderPadding * 2;

        if (options.powerOfTwo) {
            usedHeight = Math.pow(2, Math.ceil(Math.log2(Math.max(1, usedHeight))));
        }

        if (usedHeight > maxSizeLimit) return { success: false };

        let spriteArea = 0;
        for (const s of sprites) spriteArea += s.w * s.h;

        const efficiency = Math.min(1, spriteArea / (width * usedHeight));

        return {
            success: true,
            width: width,
            height: usedHeight,
            efficiency: efficiency,
            rects: packed
        };
    }

    /**
     * Tighten a candidate to the minimal bounding box that still places every
     * sprite with the same algorithm. The coarse search above only tries a
     * fixed grid of widths (32px steps, or coarser once there are many
     * sprites - see generateCandidateWidths/pickSpread), so the true minimum
     * for this specific algorithm+arrangement usually sits between two grid
     * points; binary search finds it directly instead of needing a finer grid
     * (which would cost a full extra pack at every step it added).
     *
     * Bounded by the winning width/height throughout, so this can only match
     * or improve on `result` - never regress it, even if a packer's fit-or-
     * fail behaviour isn't perfectly monotonic in bin size (a greedy
     * heuristic with no backtracking isn't guaranteed to be, in principle,
     * though it held on every case tested here).
     */
    static shrinkToFit(sprites, result, algorithm, options) {
        const fits = (w, h) => this.packWithAlgorithm(sprites, w, h, algorithm, options);

        let loW = options.minWidth || 1, hiW = result.width;
        while (hiW - loW > 1) {
            const mid = Math.floor((loW + hiW) / 2);
            if (fits(mid, result.height).success) hiW = mid; else loW = mid;
        }

        const atShrunkWidth = fits(hiW, result.height);
        if (!atShrunkWidth.success) return result;

        let loH = options.minHeight || 1, hiH = atShrunkWidth.height;
        while (hiH - loH > 1) {
            const mid = Math.floor((loH + hiH) / 2);
            if (fits(hiW, mid).success) hiH = mid; else loH = mid;
        }

        const final = fits(hiW, hiH);
        if (!final.success) return result;

        final.algorithm = algorithm;
        return final;
    }

    /**
     * Score a candidate: efficiency first, nudged toward square-ish sheets.
     */
    static score(result) {
        const ratio = Math.max(result.width / result.height, result.height / result.width);
        const penalty = AdvancedSmartSizeSolver.ASPECT_PENALTY * (1 - 1 / ratio);
        return result.efficiency * (1 - penalty);
    }

    static isBetterResult(a, b) {
        const scoreA = this.score(a);
        const scoreB = this.score(b);

        if (Math.abs(scoreA - scoreB) > 0.005) {
            return scoreA > scoreB;
        }

        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        if (areaA !== areaB) {
            return areaA < areaB;
        }

        const ratioA = Math.max(a.width / a.height, a.height / a.width);
        const ratioB = Math.max(b.width / b.height, b.height / b.width);
        return ratioA < ratioB;
    }

    /**
     * Check if scaling is required for the given dimensions
     */
    static checkScaleRequired(width, height, maxSize = MAX_SIZE_LIMIT) {
        if (width <= maxSize && height <= maxSize) {
            return { requiresScale: false, scale: 1, scaledWidth: width, scaledHeight: height };
        }

        const scaleW = maxSize / width;
        const scaleH = maxSize / height;
        const scale = Math.max(0.25, Math.min(scaleW, scaleH));

        return {
            requiresScale: true,
            scale: scale,
            scaledWidth: Math.round(width * scale),
            scaledHeight: Math.round(height * scale)
        };
    }
}

export default AdvancedSmartSizeSolver;
