/**
 * Regression suite for IdenticalDetector.js (PackProcessor.detectIdentical).
 *
 * Run with:  node test/detect-identical.test.mjs
 *
 * Cross-checks the hash-bucketed/union-find implementation against a naive
 * O(n^2) reference (obviously correct, too slow to ship) on randomized input,
 * checks structural invariants (every kept rect distinct, every dropped rect's
 * `.identical` points at a rect that's actually still kept, counts conserved),
 * and benchmarks the case that made the old implementation slow: near-duplicate
 * animation frames, which defeat compareImages' early-exit byte scan. Exits
 * non-zero on any failure.
 */

import { detectIdentical, hashBytes } from '../src/client/utils/IdenticalDetector.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function rng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

// --------------------------------------------------------------- reference

// The exact algorithm this module replaced, kept only as a slow-but-obviously-
// correct oracle for cross-checking - not the shipped implementation.
function naiveDetectIdentical(rects, didTrim) {
    function compareImages(rect1, rect2, didTrim) {
        if (!didTrim) {
            if (rect1.image._base64 === rect2.image._base64) return true;
            return rect1.image.src === rect2.image.src;
        }
        let i1 = rect1.trimmedImage, i2 = rect2.trimmedImage;
        if (i1.length !== i2.length) return false;
        let length = i1.length;
        while (length--) { if (i1[length] !== i2[length]) return false; }
        return true;
    }

    let identical = [];
    const len = rects.length;
    for (let i = 0; i < len; i++) {
        let rect1 = rects[i];
        for (let n = i + 1; n < len; n++) {
            let rect2 = rects[n];
            if (identical.indexOf(rect2) === -1 && compareImages(rect1, rect2, didTrim)) {
                rect2.identical = rect1;
                identical.push(rect2);
            }
        }
    }
    for (let rect of identical) {
        rects.splice(rects.indexOf(rect), 1);
    }
    return { rects, identical };
}

// ------------------------------------------------------------------- data

function makeRects(n, uniques, seed, opts = {}) {
    const rnd = rng(seed);
    const pixelSize = opts.pixelSize || 32;
    const templates = [];
    for (let i = 0; i < uniques; i++) {
        const buf = new Uint8Array(pixelSize * pixelSize * 4);
        for (let j = 0; j < buf.length; j++) {
            buf[j] = opts.random ? Math.floor(rnd() * 256) : (i * 37 + j) & 0xFF;
        }
        templates.push(buf);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const base = templates[Math.floor(rnd() * uniques)];
        let bytes = base;
        // A slice of near-duplicates: same template, tweaked near the front -
        // must NOT be merged, and is the case that defeats a naive byte scan's
        // early exit (real consecutive animation frames look like this).
        if (rnd() < 0.2) {
            bytes = base.slice();
            bytes[Math.floor(rnd() * Math.min(8, bytes.length))] ^= 0xFF;
        }
        const key = 'shared-' + (i % uniques);
        out.push({
            name: 'r' + i,
            image: { _base64: key, src: key },
            trimmedImage: bytes
        });
    }
    return out;
}

function clone(rects) {
    return rects.map(r => ({ name: r.name, image: { ...r.image }, trimmedImage: r.trimmedImage }));
}

// ----------------------------------------------------------------- checks

function checkInvariants(label, original, result) {
    runs++;
    const { rects: kept, identical } = result;
    const problems = [];

    if (kept.length + identical.length !== original.length) {
        problems.push(`count not conserved: ${kept.length} kept + ${identical.length} identical != ${original.length} input`);
    }

    const keptSet = new Set(kept);
    for (const item of identical) {
        if (!item.identical) { problems.push(`${item.name} has no .identical reference`); continue; }
        if (!keptSet.has(item.identical)) {
            problems.push(`${item.name}.identical (${item.identical.name}) does not point at a surviving/kept rect`);
        }
    }

    const names = new Set(kept.map(r => r.name));
    if (names.size !== kept.length) problems.push('duplicate rect appears twice in kept list');

    if (problems.length) fail(label, problems.join('; '));
}

function compareToReference(label, rects, didTrim) {
    runs++;
    const a = naiveDetectIdentical(clone(rects), didTrim);
    const b = detectIdentical(clone(rects), didTrim);

    const namesA = a.rects.map(r => r.name).sort().join(',');
    const namesB = b.rects.map(r => r.name).sort().join(',');

    if (namesA !== namesB) {
        fail(label, `kept sets differ - reference kept ${a.rects.length}, optimized kept ${b.rects.length}`);
    }
}

console.log('=== structural invariants ===');
for (let seed = 1; seed <= 10; seed++) {
    for (const didTrim of [true, false]) {
        const n = 20 + seed * 15;
        const rects = makeRects(n, Math.max(1, Math.floor(n / 6)), seed * 31);
        checkInvariants(`seed${seed} didTrim=${didTrim}`, rects, detectIdentical(clone(rects), didTrim));
    }
}

console.log('=== matches naive reference on realistic input ===');
compareToReference('random content, didTrim=true', makeRects(200, 40, 1, { random: true }), true);
compareToReference('near-duplicate frames, didTrim=true', makeRects(200, 25, 2), true);
compareToReference('all identical, didTrim=true', makeRects(60, 1, 3), true);
compareToReference('all unique, didTrim=true', makeRects(60, 60, 4), true);
compareToReference('base64/src match, didTrim=false', makeRects(200, 40, 5), false);
compareToReference('all identical, didTrim=false', makeRects(60, 1, 6), false);
compareToReference('all unique, didTrim=false', makeRects(60, 60, 7), false);

console.log('=== edge cases ===');
checkInvariants('empty', [], detectIdentical([], true));
checkInvariants('single rect', makeRects(1, 1, 8), detectIdentical(makeRects(1, 1, 8), true));

runs++;
{
    // Every rect genuinely distinct (one template each, no resampling) - must
    // stay a complete no-op: nothing collapsed.
    const rects = [];
    for (let i = 0; i < 50; i++) {
        const buf = new Uint8Array(16);
        buf[0] = i; // guarantees distinct content per rect
        rects.push({ name: 'u' + i, image: { _base64: 'u' + i, src: 'u' + i }, trimmedImage: buf });
    }
    const res = detectIdentical(clone(rects), true);
    if (res.rects.length !== 50 || res.identical.length !== 0) {
        fail('no duplicates present', `expected 50 kept/0 identical, got ${res.rects.length}/${res.identical.length}`);
    }
}

runs++;
{
    const hash1 = hashBytes(new Uint8Array([1, 2, 3, 4]));
    const hash2 = hashBytes(new Uint8Array([1, 2, 3, 4]));
    const hash3 = hashBytes(new Uint8Array([1, 2, 3, 5]));
    if (hash1 !== hash2) fail('hashBytes determinism', 'same input produced different hashes');
    if (hash1 === hash3) fail('hashBytes sensitivity', 'a 1-byte difference produced the same hash (weak, but should not happen for this input)');
}

console.log(`\n${runs - failures}/${runs} checks passed`);

// ------------------------------------------------------------------ timing

console.log('\n=== near-duplicate frames (the case that made the old scan slow) ===');
for (const [n, uniques] of [[1000, 40], [3000, 80]]) {
    const rects = makeRects(n, uniques, 11, { pixelSize: 64 });
    const t = Date.now();
    const res = detectIdentical(rects, true);
    console.log(`  n=${n} uniques=${uniques}: ${Date.now() - t}ms, kept ${res.rects.length}, collapsed ${res.identical.length}`);
}

process.exit(failures ? 1 : 0);
