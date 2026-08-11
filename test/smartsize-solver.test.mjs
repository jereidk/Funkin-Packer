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
// inventing a sheet that "fits" it.
runs++;
{
    const res = Solver.calculateOptimalDimensions([{ frame: { x: 0, y: 0, w: 9000, h: 9000 } }], {});
    if ((res.rects || []).length !== 0 || res.width <= 0 || res.height <= 0) {
        failures++;
        console.log(`FAIL oversized sprite: expected empty packing, got ${res.rects.length} rects in ${res.width}x${res.height}`);
    }
}
validate('zero-size sprite', [{ frame: { x: 0, y: 0, w: 0, h: 0 } }, { frame: { x: 0, y: 0, w: 10, h: 10 } }], {});

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
