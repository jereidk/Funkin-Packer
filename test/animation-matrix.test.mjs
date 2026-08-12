/**
 * Regression test for AnimationMatrix.js - the 2D affine helpers behind
 * the animation editor's transform gizmo.
 *
 * Run with: node test/animation-matrix.test.mjs
 */

import AM from '../src/client/utils/AnimationMatrix.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function approx(a, b, eps = 1e-6) {
    return Math.abs(a - b) < eps;
}

function approxMatrix(a, b, eps = 1e-6) {
    return a.length === b.length && a.every((v, i) => approx(v, b[i], eps));
}

console.log('=== invert() undoes multiply(): m * invert(m) is identity ===');
runs++;
{
    const m = [2, 0.5, -0.3, 1.5, 40, -20];
    const inv = AM.invert(m);
    const result = AM.multiply(m, inv);
    if (!approxMatrix(result, AM.IDENTITY, 1e-6)) {
        fail('invert round-trip', `expected identity, got ${JSON.stringify(result)}`);
    }
}

console.log('=== invert() returns null for a degenerate (zero-scale) matrix ===');
runs++;
{
    const degenerate = [0, 0, 0, 0, 5, 5];
    if (AM.invert(degenerate) !== null) {
        fail('degenerate invert', 'expected null for a zero-determinant matrix');
    }
}

console.log('=== apply() maps a local point through translation + rotation correctly ===');
runs++;
{
    // 90-degree rotation, then translate by (10, 0)
    const m = [0, 1, -1, 0, 10, 0];
    const [x, y] = AM.apply(m, 1, 0);
    // (1,0) rotated 90 CCW-in-canvas-convention -> (0,1), then +translate -> (10,1)
    if (!approx(x, 10) || !approx(y, 1)) {
        fail('apply rotation+translate', `expected (10,1), got (${x},${y})`);
    }
}

console.log('=== decompose()/compose() round-trip a pure translation ===');
runs++;
{
    const m = [1, 0, 0, 1, 42, -13];
    const d = AM.decompose(m);
    const recomposed = AM.compose(d);
    if (!approxMatrix(recomposed, m)) {
        fail('translation round-trip', `expected ${JSON.stringify(m)}, got ${JSON.stringify(recomposed)}`);
    }
}

console.log('=== decompose()/compose() round-trip a rotation + non-uniform scale ===');
runs++;
{
    const rotation = Math.PI / 6; // 30 degrees
    const scaleX = 2, scaleY = 0.5, tx = 5, ty = 7;
    const m = AM.compose({ rotation, scaleX, scaleY, tx, ty });
    const d = AM.decompose(m);

    if (!approx(d.scaleX, scaleX)) fail('scaleX round-trip', `expected ${scaleX}, got ${d.scaleX}`);
    if (!approx(d.scaleY, scaleY)) fail('scaleY round-trip', `expected ${scaleY}, got ${d.scaleY}`);
    if (!approx(d.rotation, rotation)) fail('rotation round-trip', `expected ${rotation}, got ${d.rotation}`);
    if (!approx(d.tx, tx) || !approx(d.ty, ty)) fail('translation round-trip', `expected (${tx},${ty}), got (${d.tx},${d.ty})`);

    const recomposed = AM.compose(d);
    if (!approxMatrix(recomposed, m)) {
        fail('full round-trip', `expected ${JSON.stringify(m)}, got ${JSON.stringify(recomposed)}`);
    }
}

console.log('=== multiply() composes in the order a nested transform expects ===');
runs++;
{
    const parent = [1, 0, 0, 1, 100, 0]; // translate by (100, 0)
    const child = [1, 0, 0, 1, 0, 50];   // then translate by (0, 50) in child-local space
    const combined = AM.multiply(parent, child);
    const [x, y] = AM.apply(combined, 0, 0);
    if (!approx(x, 100) || !approx(y, 50)) {
        fail('multiply order', `expected (100,50), got (${x},${y})`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
