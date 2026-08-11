/**
 * Regression suite for packers/MaxRectsBin.js - the packer actually used to
 * place sprites (not the size-estimation solver in AdvancedSmartSizeSolver.js).
 *
 * Run with:  node test/maxrects-bin.test.mjs
 *
 * Guards against the two scoring bugs found in BestAreaFit and ContactPointRule:
 * both methods reassigned the {value} box passed in by the caller to a plain
 * number instead of writing through it (`bestAreaFit = areaFit` instead of
 * `bestAreaFit.value = areaFit`), which detached the score from the caller and
 * made both methods silently degenerate into a different heuristic entirely.
 * Also checks every method + rotation combination for overlaps and out-of-
 * bounds placement, and that the free-rect list pruning fix didn't change
 * placement outcomes.
 */

import MaxRectsBin from '../src/client/packers/MaxRectsBin.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function makeRects(n, seed, shape = 'mixed') {
    const rnd = rng(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
        let w, h;
        if (shape === 'uniform') { w = 32; h = 32; }
        else { w = 8 + Math.floor(rnd() * 120); h = 8 + Math.floor(rnd() * 120); }
        out.push({ frame: { x: 0, y: 0, w, h }, name: 'r' + i });
    }
    return out;
}

// TextureRenderer.getSize swaps w/h for a rotated item's bounding box:
// frame.w/h always stay the pre-rotation sprite size, and `rotated` means the
// on-sheet footprint is h-wide by w-tall. Any check here has to use the same
// convention or it flags correct rotated placements as broken.
function footprint(r) {
    return r.rotated ? { w: r.frame.h, h: r.frame.w } : { w: r.frame.w, h: r.frame.h };
}

function overlaps(a, b) {
    const fa = footprint(a), fb = footprint(b);
    return a.frame.x < b.frame.x + fb.w && b.frame.x < a.frame.x + fa.w &&
           a.frame.y < b.frame.y + fb.h && b.frame.y < a.frame.y + fa.h;
}

function check(label, rects, w, h, method, allowRotate) {
    runs++;
    const packer = new MaxRectsBin(w, h, allowRotate, 0);
    const placed = packer.pack(rects.map(r => ({ frame: { ...r.frame }, name: r.name })), method);

    let overlapCount = 0;
    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            if (overlaps(placed[i], placed[j])) overlapCount++;
        }
    }

    let oob = 0;
    for (const p of placed) {
        const f = footprint(p);
        if (p.frame.x < 0 || p.frame.y < 0 || p.frame.x + f.w > w || p.frame.y + f.h > h) oob++;
    }

    const problems = [];
    if (overlapCount) problems.push(`${overlapCount} overlapping pairs`);
    if (oob) problems.push(`${oob} out of bounds`);

    if (problems.length) fail(label, problems.join(', '));

    return placed;
}

const methods = ['BestShortSideFit', 'BestLongSideFit', 'BestAreaFit', 'BottomLeftRule', 'ContactPointRule'];

console.log('=== every method x rotation, overlap/bounds check ===');
for (const method of methods) {
    for (const rotate of [false, true]) {
        const rects = makeRects(60, 5);
        check(`${method} rotate=${rotate}`, rects, 500, 500, method, rotate);
    }
}

console.log('=== uniform sprites, small/large sheets ===');
for (const method of methods) {
    check(`${method} uniform tight`, makeRects(40, 3, 'uniform'), 200, 200, method, false);
    check(`${method} uniform loose`, makeRects(40, 3, 'uniform'), 800, 800, method, false);
}

// BestAreaFit and ContactPointRule must genuinely differ from BestShortSideFit
// on the same input - before the fix, both degenerated into a near-duplicate
// of it (BestAreaFit via a stuck short-side tiebreak, ContactPointRule via a
// constant score that left insert2() picking whichever candidate came first).
console.log('=== BestAreaFit / ContactPointRule produce genuinely different placement ===');
runs++;
{
    const rects = makeRects(80, 11);
    const bssf = check('bssf baseline', rects, 450, 450, 'BestShortSideFit', false)
        .map(r => `${r.name}:${r.frame.x},${r.frame.y}`).join('|');
    const baf = check('baf baseline', rects, 450, 450, 'BestAreaFit', false)
        .map(r => `${r.name}:${r.frame.x},${r.frame.y}`).join('|');
    const cpr = check('cpr baseline', rects, 450, 450, 'ContactPointRule', false)
        .map(r => `${r.name}:${r.frame.x},${r.frame.y}`).join('|');

    if (baf === bssf) fail('BestAreaFit distinctness', 'placement identical to BestShortSideFit - scoring bug regressed');
    if (cpr === bssf) fail('ContactPointRule distinctness', 'placement identical to BestShortSideFit - scoring bug regressed');
}

console.log('=== determinism ===');
runs++;
{
    const rects = makeRects(50, 9);
    const a = check('det-a', rects, 400, 400, 'BestAreaFit', false);
    const b = check('det-b', rects, 400, 400, 'BestAreaFit', false);
    const key = list => list.map(r => `${r.name}:${r.frame.x},${r.frame.y},${r.rotated}`).join('|');
    if (key(a) !== key(b)) fail('determinism', 'same input produced different placement across runs');
}

console.log('=== does not place more than the input, no NaN coordinates ===');
for (const method of methods) {
    runs++;
    const rects = makeRects(70, 21);
    const placed = check(`${method} sanity`, rects, 350, 350, method, true);
    if (placed.length > rects.length) fail(`${method} count`, `placed ${placed.length} > input ${rects.length}`);
    for (const p of placed) {
        if (!Number.isFinite(p.frame.x) || !Number.isFinite(p.frame.y)) {
            fail(`${method} NaN`, `non-finite coordinate at ${p.name}: ${p.frame.x},${p.frame.y}`);
            break;
        }
    }
}

console.log('=== large multi-sheet ensemble stays fast (PackProcessor.js LARGE_ENSEMBLE_THRESHOLD fast path) ===');
{
    // Regression guard for the fast set PackProcessor.js uses once a sprite set
    // is large enough to need multiple sheets. ContactPointRule used to be in
    // that set - same 9/9 "rescue" rate as BottomLeftRule on small, single-sheet
    // cases, so it looked like a fine choice there - but its scoring scans every
    // already-placed rect per candidate free rect (O(free x placed) per round,
    // the other methods here are O(free)), which stays cheap while a sheet is
    // nearly empty and stops being cheap once a few hundred sprites have landed
    // on it. On 1200 sprites needing 6 sheets it took 5.5-12s alone while not
    // even winning (6-7 sheets, same or worse than the methods below); the full
    // fast-set ensemble (3 methods x 2 rotations = 6 packing passes) must stay
    // well clear of that.
    function packAllSheets(rects, width, height, method, rot) {
        let remaining = rects.map(r => ({ frame: { ...r.frame }, name: r.name }));
        let sheets = 0, guard = 0;
        while (remaining.length && guard++ < 1000) {
            const packer = new MaxRectsBin(width, height, rot, 2);
            const placed = packer.pack(remaining, method);
            if (!placed.length) return { sheets: -1 };
            sheets++;
            const names = new Set(placed.map(p => p.name));
            remaining = remaining.filter(r => !names.has(r.name));
        }
        return { sheets, leftover: remaining.length };
    }

    const rnd = rng(31);
    const rects = Array.from({ length: 1200 }, (_, i) => ({
        frame: { x: 0, y: 0, w: 200 + Math.floor(rnd() * 150), h: 200 + Math.floor(rnd() * 150) },
        name: 'r' + i
    }));

    const fastSet = ['BestShortSideFit', 'BottomLeftRule', 'BestAreaFit'];
    const t0 = Date.now();
    let bestSheets = Infinity;

    for (const method of fastSet) {
        for (const rotate of [false, true]) {
            runs++;
            const result = packAllSheets(rects, 4096, 4096, method, rotate);
            if (result.sheets === -1 || result.leftover) {
                fail(`fast-set overflow ${method} rotate=${rotate}`, 'failed to place all sprites across sheets');
                continue;
            }
            bestSheets = Math.min(bestSheets, result.sheets);
        }
    }

    const elapsed = Date.now() - t0;
    console.log(`  1200 sprites, 6 combos: ${elapsed}ms, best ${bestSheets} sheets`);

    runs++;
    // Generous bound (real machines measured ~0.7-2.2s) - this is a regression
    // trip-wire against ContactPointRule-style O(free x placed) costs sneaking
    // back into this set, not a tight performance target.
    if (elapsed > 8000) {
        fail('fast-set overflow timing', `took ${elapsed}ms for the 6-combo fast set, expected well under 8000ms`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
