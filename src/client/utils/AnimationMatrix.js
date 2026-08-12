/**
 * AnimationMatrix - 2D affine matrix helpers for the animation editor's
 * transform gizmo. Matrices are the same [a, b, c, d, tx, ty] 6-element
 * form Animation.json's MX fields use (matches
 * CanvasRenderingContext2D.transform(a,b,c,d,e,f) directly).
 *
 * Kept dependency-free and pure so the math can be exercised directly in
 * test/animation-matrix.test.mjs.
 */

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiply(parent, child) {
    const [pa, pb, pc, pd, ptx, pty] = parent;
    const [ca, cb, cc, cd, ctx, cty] = child;

    return [
        pa * ca + pc * cb,
        pb * ca + pd * cb,
        pa * cc + pc * cd,
        pb * cc + pd * cd,
        pa * ctx + pc * cty + ptx,
        pb * ctx + pd * cty + pty
    ];
}

/**
 * Invert a matrix. Returns null for a degenerate (zero-determinant) matrix
 * rather than dividing by zero - callers should treat that as "can't map
 * screen space back through this transform" and skip the operation.
 */
function invert(m) {
    const [a, b, c, d, tx, ty] = m;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) return null;

    const invDet = 1 / det;
    const ia = d * invDet;
    const ib = -b * invDet;
    const ic = -c * invDet;
    const id = a * invDet;

    return [
        ia, ib, ic, id,
        -(ia * tx + ic * ty),
        -(ib * tx + id * ty)
    ];
}

/** Apply a matrix to a point, returning [x, y]. */
function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Decompose into { rotation (radians), scaleX, scaleY, tx, ty }. Ignores
 * skew (treats the matrix as rotation * uniform-per-axis-scale *
 * translation) - exact for every real MX seen from Adobe Animate/BetterTA
 * exports so far, and a reasonable approximation for anything skewed.
 */
function decompose(m) {
    const [a, b, c, d, tx, ty] = m;
    const scaleX = Math.sqrt(a * a + b * b);
    const rotation = Math.atan2(b, a);
    // Signed scaleY via the determinant so a Y-flip (negative determinant)
    // is preserved instead of silently becoming a positive scale.
    const det = a * d - b * c;
    const scaleY = scaleX !== 0 ? det / scaleX : 0;

    return { rotation, scaleX, scaleY, tx, ty };
}

/** Inverse of decompose(): rebuild an [a,b,c,d,tx,ty] matrix. */
function compose({ rotation, scaleX, scaleY, tx, ty }) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [
        scaleX * cos, scaleX * sin,
        -scaleY * sin, scaleY * cos,
        tx, ty
    ];
}

export default {
    IDENTITY,
    multiply,
    invert,
    apply,
    decompose,
    compose
};
