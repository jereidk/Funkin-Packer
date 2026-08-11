/**
 * Regression suite for AdvancedSmartSizeSolver.
 *
 * Run with:  node test/smartsize-solver.test.mjs
 *
 * Checks every packer for overlapping sprites, out-of-bounds placement,
 * impossible (>100%) efficiency and size-limit violations, across padding /
 * borderPadding / rotation / power-of-two option combinations. Exits non-zero
 * on any failure.
 */
import Solver from '../src/client/utils/AdvancedSmartSizeSolver.js';

let failures = 0, runs = 0;

function rng(seed) {
    let s = seed || 1;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function overlaps(a, b, pad) {
    return (a.x - pad) < (b.x + b.w + pad) && (b.x - pad) < (a.x + a.w + pad) &&
           (a.y - pad) < (b.y + b.h + pad) && (b.y - pad) < (a.y + a.h + pad);
}

function validate(label, rects, opts) {
    runs++;
    const res = Solver.calculateOptimalDimensions(rects, opts);
    const pad = opts.padding || 0, bp = opts.borderPadding || 0;
    const placed = res.rects || [];
    const bad = [];

    if (placed.length !== rects.length) bad.push(`placed ${placed.length}/${rects.length}`);

    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            if (overlaps(placed[i], placed[j], pad)) { bad.push(`overlap ${i}/${j}`); i = j = placed.length; break; }
        }
    }
    for (const p of placed) {
        if (p.x < bp || p.y < bp || p.x + p.w > res.width - bp || p.y + p.h > res.height - bp) {
            bad.push(`oob at ${p.x},${p.y} ${p.w}x${p.h} in ${res.width}x${res.height}`);
            break;
        }
    }
    if (res.efficiency > 1.0001) bad.push(`efficiency ${res.efficiency} > 1`);
    if (res.width <= 0 || res.height <= 0) bad.push(`bad dims ${res.width}x${res.height}`);
    if (!opts.disableMaxLimit && (res.width > 4096 || res.height > 4096) && placed.length) {
        bad.push(`exceeds 4096: ${res.width}x${res.height}`);
    }
    if (opts.powerOfTwo && placed.length) {
        const pot = n => (n & (n - 1)) === 0;
        if (!pot(res.width) || !pot(res.height)) bad.push(`not POT: ${res.width}x${res.height}`);
    }

    if (bad.length) {
        failures++;
        console.log(`FAIL ${label}: ${bad.join('; ')}`);
    }
    return res;
}

// --- randomized sweep across shapes, counts and option combos ---
const optionSets = [
    {},
    { padding: 1 },
    { padding: 4 },
    { padding: 8, borderPadding: 4 },
    { padding: 2, borderPadding: 16 },
    { allowRotation: true },
    { allowRotation: true, padding: 4, borderPadding: 4 },
    { powerOfTwo: true },
    { powerOfTwo: true, padding: 4, borderPadding: 8 },
    { disableMaxLimit: true, padding: 2 }
];

for (let seed = 1; seed <= 12; seed++) {
    const rnd = rng(seed * 31);
    const n = 1 + Math.floor(rnd() * 60);
    const shape = seed % 4;

    const rects = [];
    for (let i = 0; i < n; i++) {
        let w, h;
        if (shape === 0) { w = 8 + Math.floor(rnd() * 120); h = 8 + Math.floor(rnd() * 120); }      // mixed
        else if (shape === 1) { w = 64; h = 64; }                                                    // uniform
        else if (shape === 2) { w = 4 + Math.floor(rnd() * 20); h = 100 + Math.floor(rnd() * 200); } // tall slivers
        else { w = 100 + Math.floor(rnd() * 200); h = 4 + Math.floor(rnd() * 20); }                  // wide slivers
        rects.push({ frame: { x: 0, y: 0, w, h } });
    }

    for (const opts of optionSets) {
        validate(`seed${seed} n=${n} shape${shape} ${JSON.stringify(opts)}`, rects, opts);
    }
}

// --- edge cases ---
validate('empty', [], {});
validate('1x1 sprite', [{ frame: { x: 0, y: 0, w: 1, h: 1 } }], { padding: 4, borderPadding: 4 });
validate('sprite at limit', [{ frame: { x: 0, y: 0, w: 4096, h: 10 } }], {});
validate('two maxed sprites', [
    { frame: { x: 0, y: 0, w: 4000, h: 2000 } },
    { frame: { x: 0, y: 0, w: 4000, h: 2000 } }
], {});
// A sprite larger than the size limit cannot be placed; the solver must report an
// empty packing (which PackProcessor turns into INVALID_SIZE_ERROR) rather than
// inventing a sheet that "fits" it. It should still clamp to the size cap exactly
// (4096x4096), not something arbitrary - PackProcessor's minWidth/minHeight check
// is what actually raises the error, using this as the width/height to compare.
runs++;
{
    const res = Solver.calculateOptimalDimensions([{ frame: { x: 0, y: 0, w: 9000, h: 9000 } }], {});
    if ((res.rects || []).length !== 0 || res.width !== 4096 || res.height !== 4096) {
        failures++;
        console.log(`FAIL oversized sprite: expected empty packing at 4096x4096, got ${res.rects.length} rects in ${res.width}x${res.height}`);
    }
}
validate('zero-size sprite', [{ frame: { x: 0, y: 0, w: 0, h: 0 } }, { frame: { x: 0, y: 0, w: 10, h: 10 } }], {});

// --- multi-sheet fallback: content that can never fit on one sheet ---
//
// When many individually-small sprites together exceed one sheet's capacity,
// the solver cannot find a width where ALL of them fit (packWithAlgorithm is
// all-or-nothing per candidate), so every candidate fails and it falls back.
// That fallback used to report roughly "the size of the largest single
// sprite" for this case too - meaning PackProcessor.pack()'s multi-sheet while
// loop (which keeps opening new sheets of that size until everything is
// placed) opened one near-empty sheet after another: 600 sprites that need
// ~3 full sheets' worth of area produced 600 output sheets instead of 3.
console.log('=== multi-sheet fallback (content that cannot fit on one sheet) ===');

function makeOverflowRects(n, seed) {
    const rnd = rng(seed);
    return Array.from({ length: n }, () => ({
        frame: { x: 0, y: 0, w: 200 + Math.floor(rnd() * 150), h: 200 + Math.floor(rnd() * 150) }
    }));
}

for (const n of [300, 600, 1200]) {
    runs++;
    const rects = makeOverflowRects(n, n * 7);
    const totalArea = rects.reduce((s, r) => s + r.frame.w * r.frame.h, 0);

    // sanity: this input really doesn't fit on one 4096x4096 sheet, or the
    // case isn't testing what it claims to
    if (totalArea <= 4096 * 4096) {
        failures++;
        console.log(`FAIL multi-sheet fixture n=${n}: total area fits in one sheet, fixture is not testing overflow`);
        continue;
    }

    const res = Solver.calculateOptimalDimensions(rects, { padding: 2 });
    // Must aim for (at least close to) the full size cap, not "one sprite's worth"
    if (res.width < 3000 || res.height < 3000) {
        failures++;
        console.log(`FAIL multi-sheet fallback n=${n}: got ${res.width}x${res.height}, expected close to the 4096 cap`);
    }
}

// Same fallback, but a single oversized sprite must still win over the
// multi-sheet branch - it can never fit no matter how many sheets are used.
// The oversized sprite here is 9000 wide but only 200 tall, so minWidth (from
// its width) exceeds the cap while minHeight (driven by the OTHER, smaller
// sprites) does not - each dimension is independently clamped to
// min(that dimension's minimum, maxSizeLimit), so only width is forced to
// 4096; what actually matters is that PackProcessor.pack()'s own
// `width < minWidth` check still catches it and raises INVALID_SIZE_ERROR.
runs++;
{
    const rects = makeOverflowRects(50, 999).concat([{ frame: { x: 0, y: 0, w: 9000, h: 200 } }]);
    const res = Solver.calculateOptimalDimensions(rects, {});
    const minWidth = 9000, minHeight = Math.max(...rects.map(r => r.frame.h));
    if (!(res.width < minWidth || res.height < minHeight)) {
        failures++;
        console.log(`FAIL multi-sheet + oversized mix: ${res.width}x${res.height} would NOT trigger INVALID_SIZE_ERROR against minWidth=${minWidth}`);
    }
}

// powerOfTwo must still hold in the overflow case. (isPowerOfTwo is defined
// further down, in the shrinkToFit section - function declarations are
// hoisted, so it's callable here.)
runs++;
{
    const rects = makeOverflowRects(600, 11);
    const res = Solver.calculateOptimalDimensions(rects, { powerOfTwo: true });
    if (!isPowerOfTwo(res.width) || !isPowerOfTwo(res.height)) {
        failures++;
        console.log(`FAIL multi-sheet + powerOfTwo: got ${res.width}x${res.height}, not power-of-two`);
    }
}

// --- determinism ---
const fixed = Array.from({ length: 30 }, (_, i) => ({ frame: { x: 0, y: 0, w: 20 + i, h: 40 - (i % 20) } }));
const a = Solver.calculateOptimalDimensions(fixed, { padding: 2 });
const b = Solver.calculateOptimalDimensions(fixed, { padding: 2 });
runs++;
if (a.width !== b.width || a.height !== b.height || a.algorithm !== b.algorithm) {
    failures++;
    console.log(`FAIL determinism: ${a.width}x${a.height}/${a.algorithm} vs ${b.width}x${b.height}/${b.algorithm}`);
}

// --- input must not be mutated ---
const orig = [{ frame: { x: 0, y: 0, w: 33, h: 44 } }, { frame: { x: 0, y: 0, w: 12, h: 90 } }];
const snapshot = JSON.stringify(orig);
Solver.calculateOptimalDimensions(orig, { padding: 3 });
runs++;
if (JSON.stringify(orig) !== snapshot) { failures++; console.log('FAIL: solver mutated its input rects'); }

// --- shrinkToFit: the coarse search only tries a 32px-ish grid of widths, so
// the true minimal bounding box for the winning algorithm+arrangement usually
// sits between grid points. A binary-search pass squeezes that out - it must
// never make the result worse (bigger area) or invalid, and must never break
// powerOfTwo's one guarantee (both dimensions stay an exact power of two).
console.log('=== shrinkToFit ===');

function isPowerOfTwo(n) { return n > 0 && (n & (n - 1)) === 0; }

for (let seed = 1; seed <= 15; seed++) {
    const rnd = rng(seed * 41);
    const n = 20 + (seed % 6) * 25;
    const rects = Array.from({ length: n }, () => ({
        frame: { x: 0, y: 0, w: 8 + Math.floor(rnd() * 120), h: 8 + Math.floor(rnd() * 120) }
    }));
    const opts = [{}, { padding: 2 }, { padding: 4, borderPadding: 4 }, { allowRotation: true }][seed % 4];

    validate(`shrinkToFit seed${seed}`, rects, opts);
}

// powerOfTwo must come out exactly POT on both axes - shrinkToFit is skipped
// entirely for this mode (see AdvancedSmartSizeSolver.calculateOptimalDimensions).
for (let seed = 1; seed <= 8; seed++) {
    runs++;
    const rnd = rng(seed * 53);
    const n = 15 + seed * 10;
    const rects = Array.from({ length: n }, () => ({
        frame: { x: 0, y: 0, w: 8 + Math.floor(rnd() * 120), h: 8 + Math.floor(rnd() * 120) }
    }));
    const res = Solver.calculateOptimalDimensions(rects, { powerOfTwo: true, padding: 2 });
    if (res.rects.length && (!isPowerOfTwo(res.width) || !isPowerOfTwo(res.height))) {
        failures++;
        console.log(`FAIL powerOfTwo seed${seed}: got ${res.width}x${res.height}, not power-of-two`);
    }
}

// Never worse than the un-shrunk candidate: call the two pieces directly and
// confirm the shrunk box is <= the original in area and still places
// everything (Solver.shrinkToFit/packWithAlgorithm are exposed statics).
for (let seed = 1; seed <= 10; seed++) {
    runs++;
    const rnd = rng(seed * 67);
    const n = 20 + seed * 8;
    const sprites = Array.from({ length: n }, () => ({
        w: 8 + Math.floor(rnd() * 100), h: 8 + Math.floor(rnd() * 100)
    }));
    const algorithm = ['maxrects_bssf', 'guillotine_baf', 'shelf', 'skyline'][seed % 4];
    const packOpts = { padding: 2, borderPadding: 0, allowRotation: false, maxSizeLimit: 4096 };

    // an intentionally loose starting box, like a coarse-grid candidate would be
    const totalArea = sprites.reduce((s, r) => s + r.w * r.h, 0);
    const side = Math.ceil(Math.sqrt(totalArea / 0.6));
    const original = Solver.packWithAlgorithm(sprites, side, side, algorithm, packOpts);

    if (!original.success) continue; // loose box should always succeed; skip defensively if not

    original.algorithm = algorithm;
    const shrunk = Solver.shrinkToFit(sprites, original, algorithm, { ...packOpts, minWidth: 1, minHeight: 1 });

    if (shrunk.width * shrunk.height > original.width * original.height) {
        failures++;
        console.log(`FAIL shrinkToFit regression seed${seed}: ${shrunk.width}x${shrunk.height} > original ${original.width}x${original.height}`);
    }
    if (shrunk.rects.length !== sprites.length) {
        failures++;
        console.log(`FAIL shrinkToFit lost sprites seed${seed}: ${shrunk.rects.length}/${sprites.length}`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);

// --- timing on a realistic worst case ---
for (const n of [200, 500, 1000]) {
    const rnd = rng(99);
    const r = Array.from({ length: n }, () => ({
        frame: { x: 0, y: 0, w: 8 + Math.floor(rnd() * 100), h: 8 + Math.floor(rnd() * 100) }
    }));
    const t = Date.now();
    const res = Solver.calculateOptimalDimensions(r, { padding: 2 });
    console.log(`${n} sprites: ${Date.now() - t} ms -> ${res.width}x${res.height} ${res.algorithm} ${(res.efficiency * 100).toFixed(1)}%`);
}

process.exit(failures ? 1 : 0);
