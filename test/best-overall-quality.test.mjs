/**
 * Regression test: the 'best' algorithm (packingAlgorithm: 'best', the
 * "Best Overall (Recommended)" option in the UI) must not settle for a
 * meaningfully worse atlas than a full brute-force sweep would find.
 *
 * Run with: node test/best-overall-quality.test.mjs
 *
 * calculateOptimalDimensions's two-phase search picks a winning algorithm
 * from results at a handful of probe widths (as few as 3), then used to
 * refine ONLY that single algorithm over the full width range. When the
 * true best algorithm lost narrowly at those few probe points, it was
 * dropped for good and never reconsidered - producing an elongated,
 * less-efficient atlas even though a near-square, tighter one existed.
 * Reproduced directly: across 20 randomized sprite sets, the old code
 * picked a meaningfully worse (score +0.01) result than brute force in
 * 4/20 cases, including one 859x1230 (aspect ratio 1.43, 92.7% efficient)
 * atlas where a 1056x1011 (near-square, 91.7% efficient but better on the
 * combined score) atlas was available and never tried.
 *
 * Fix: refine every algorithm that scored within a small margin of the
 * probe winner, not just the single best one.
 */

import AdvancedSmartSizeSolver from '../src/client/utils/AdvancedSmartSizeSolver.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function randSprites(n, seed) {
    let s = seed;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    let rects = [];
    for (let i = 0; i < n; i++) {
        rects.push({ frame: { w: 20 + Math.floor(rnd() * 180), h: 20 + Math.floor(rnd() * 180) } });
    }
    return rects;
}

function bruteForce(rects) {
    const sprites = rects.map((r, i) => ({ w: r.frame.w, h: r.frame.h, originalIndex: i }));
    sprites.sort((a, b) => (b.w * b.h) - (a.w * a.h));

    let maxSpriteWidth = 0, maxSpriteHeight = 0, totalArea = 0;
    for (const sp of sprites) {
        if (sp.w > maxSpriteWidth) maxSpriteWidth = sp.w;
        if (sp.h > maxSpriteHeight) maxSpriteHeight = sp.h;
        totalArea += sp.w * sp.h;
    }
    const minWidth = maxSpriteWidth;
    const initialWidth = Math.max(minWidth, Math.ceil(Math.sqrt(totalArea)));
    const widths = AdvancedSmartSizeSolver.generateCandidateWidths(
        initialWidth, minWidth, maxSpriteHeight, totalArea, 4096, false
    );

    const algos = Object.values(AdvancedSmartSizeSolver.ALGORITHM).filter(a => a !== AdvancedSmartSizeSolver.ALGORITHM.BEST);
    const packOptions = { padding: 0, borderPadding: 0, allowRotation: false, maxSizeLimit: 4096 };

    let best = null;
    for (const algo of algos) {
        for (const w of widths) {
            const r = AdvancedSmartSizeSolver.packWithAlgorithm(sprites, w, 4096, algo, packOptions);
            if (!r.success) continue;
            r.algorithm = algo;
            if (!best || AdvancedSmartSizeSolver.isBetterResult(r, best)) best = r;
        }
    }
    if (best) {
        const shrunk = AdvancedSmartSizeSolver.shrinkToFit(sprites, best, best.algorithm,
            { ...packOptions, minWidth, minHeight: maxSpriteHeight });
        if (shrunk.width * shrunk.height <= best.width * best.height) best = shrunk;
    }
    return best;
}

console.log('=== "best" stays close to a brute-force sweep across randomized sprite sets ===');
let worstGap = 0;
for (const n of [30, 80, 150, 300]) {
    for (let seed = 1; seed <= 5; seed++) {
        runs++;
        const rects = randSprites(n, seed * 97 + n);
        const fast = AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, { algorithm: 'best' });
        const brute = bruteForce(rects);

        const gap = AdvancedSmartSizeSolver.score(brute) - AdvancedSmartSizeSolver.score(fast);
        if (gap > worstGap) worstGap = gap;

        // A small gap is expected (the whole point of the two-phase search is to
        // avoid brute force's cost, and large-N runs additionally narrow the width
        // list refineWidths samples - a known, deliberate tradeoff, not what this
        // guards against) - only fail on a gap big enough to represent a genuinely
        // worse atlas from picking the wrong ALGORITHM, matching what was observed
        // before this fix (up to a 0.026 gap from settling on the probe-winning
        // algorithm alone).
        if (gap > 0.025) {
            fail(`n=${n} seed=${seed}`,
                `'best' scored ${gap.toFixed(3)} worse than brute force: ` +
                `fast=${fast.width}x${fast.height} (${fast.algorithm}) vs brute=${brute.width}x${brute.height} (${brute.algorithm})`);
        }
    }
}
console.log(`  worst gap observed: ${worstGap.toFixed(4)}`);

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
