/**
 * AnimationRenderer - Pure playback logic for Animation.json's Adobe
 * Animate-style symbol hierarchy.
 *
 * Every symbol (the root "AN" timeline included) has the same shape:
 *   { TL: { L: [ { LN, FR: [ { I, DU, N?, E: [...] } ] } ] } }
 * where each frame's E (elements) array holds either:
 *   - { ASI: { N, MX } }     - a bitmap sprite instance (leaf)
 *   - { SI: { SN, FF, MX } } - a nested symbol instance (recurse)
 * MX is a 6-element affine matrix [a, b, c, d, tx, ty], directly usable
 * with CanvasRenderingContext2D.transform(a, b, c, d, e, f) - Animate's
 * own transform convention already matches Canvas 2D's.
 *
 * Nested symbols advance independently on their own local playhead: Adobe
 * Animate's "Graphic" symbol timelines (ST: "G") loop by default
 * (LP: "LP"), offset by FF (their own first-frame index) and advanced by
 * however many ticks the PARENT has spent inside the frame that placed
 * them - this file only implements that one (loop) mode, which is what
 * every export seen from this app and from real Adobe Animate/BetterTA
 * exports uses; a "play once" or "single frame" mode isn't attempted.
 *
 * Kept dependency-free (no canvas, no DOM) so the frame-resolution and
 * matrix math can be exercised directly in test/animation-renderer.test.mjs.
 */

const MAX_RECURSION_DEPTH = 64;

/**
 * Compose two affine matrices: applying `child` first, then `parent`.
 * Matches how nested MX transforms accumulate down the symbol tree.
 */
function multiplyMatrix(parent, child) {
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

const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

/**
 * Total tick length of a timeline node: one past the last frame's end
 * across every layer. A symbol with no frames at all has a length of 1
 * (a static single frame) so callers never divide or modulo by zero.
 */
function getTimelineDuration(timelineNode) {
    let maxEnd = 0;
    const layers = timelineNode?.TL?.L || [];
    for (const layer of layers) {
        for (const frame of layer.FR || []) {
            const end = (frame.I || 0) + (frame.DU || 1);
            if (end > maxEnd) maxEnd = end;
        }
    }
    return Math.max(1, maxEnd);
}

/**
 * Find the frame in a single layer's FR list that covers `tick`, i.e. the
 * frame with the largest I such that I <= tick. Frames are assumed sorted
 * by I ascending (true of every Animation.json produced by this app or by
 * Adobe Animate/BetterTA). Returns null if the layer has no frames or
 * `tick` falls before the first one.
 */
function resolveFrame(layerFrames, tick) {
    let active = null;
    for (const frame of layerFrames) {
        const start = frame.I || 0;
        if (start > tick) break;
        active = frame;
    }
    return active;
}

/**
 * Recursively walk a symbol's timeline at local tick `tick`, appending
 * { spriteName, matrix } draw entries (in layer/element order - later
 * entries draw on top) to `out`.
 *
 * @param {object} symbolsByName - Map-like lookup: SN -> symbol definition
 *   (an object with the same { TL: { L: [...] } } shape). Pass a real Map
 *   or a plain object with a `.get`-free plain-object fallback - see
 *   buildSymbolLookup().
 */
function walkTimeline(timelineNode, tick, parentMatrix, symbolsByName, out, depth) {
    if (depth > MAX_RECURSION_DEPTH) return; // guard against a cyclic SI reference

    const layers = timelineNode?.TL?.L || [];
    // Draw from the LAST layer in the array to the first. Verified against
    // flixel-animate (the actual Haxe library that consumes this exact
    // Animation.json schema in-game - FlxAnimate.hx's parseElement()):
    // `for (i in 0...layers.length) { var layer = layers[layers.length-1-i]; ... }`.
    // So layer index 0 (as Animate's own Timeline panel lists it, top layer
    // first) is drawn LAST here and ends up on top - the earlier version drew
    // array order forward, putting layer 0 furthest back instead.
    for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        const frame = resolveFrame(layer.FR || [], tick);
        if (!frame) continue;

        const frameStart = frame.I || 0;
        const localOffsetIntoFrame = tick - frameStart;

        for (const element of frame.E || []) {
            if (element.ASI && element.ASI.N) {
                const matrix = multiplyMatrix(parentMatrix, element.ASI.MX || IDENTITY_MATRIX);
                out.push({ spriteName: element.ASI.N, matrix });
            } else if (element.SI && element.SI.SN) {
                const child = symbolsByName.get(element.SI.SN);
                if (!child) continue; // orphaned reference - AnimationLinker already surfaces this separately

                const matrix = multiplyMatrix(parentMatrix, element.SI.MX || IDENTITY_MATRIX);
                const childDuration = getTimelineDuration(child);
                const firstFrame = element.SI.FF || 0;
                // Graphic symbols loop: their own local tick is the parent's
                // elapsed time inside the placing frame, offset by FF, wrapped
                // to the child's own length.
                const childTick = (firstFrame + localOffsetIntoFrame) % childDuration;

                walkTimeline(child, childTick, matrix, symbolsByName, out, depth + 1);
            }
        }
    }
}

/**
 * Build a Map from symbol name to symbol definition out of Animation.json's
 * SD.S array, for fast lookup during the recursive walk.
 */
function buildSymbolLookup(animData) {
    const map = new Map();
    for (const symbol of animData?.SD?.S || []) {
        if (symbol.SN) map.set(symbol.SN, symbol);
    }
    return map;
}

/**
 * Compute the flat, ordered list of sprite draw calls for the root
 * timeline (animData.AN) at the given global tick.
 *
 * @param {object} animData - Parsed Animation.json.
 * @param {number} tick - Global playhead position, in frame ticks (not
 *   wrapped - callers loop the ROOT the same way nested symbols loop,
 *   via `tick % getRootDuration(animData)`, since the root is just
 *   another timeline with the same shape).
 * @returns {Array<{spriteName: string, matrix: number[]}>}
 */
function computeDrawList(animData, tick) {
    const out = [];
    if (!animData?.AN) return out;

    const symbolsByName = buildSymbolLookup(animData);
    walkTimeline(animData.AN, tick, IDENTITY_MATRIX, symbolsByName, out, 0);
    return out;
}

/**
 * Total tick length of the root timeline (animData.AN).
 */
function getRootDuration(animData) {
    return getTimelineDuration(animData?.AN);
}

/**
 * Collect { name, startTick, duration } for every top-level named frame
 * (frame.N) on the root timeline - these are the human-facing "states"
 * (Idle, Left, Right Miss, ...) a user would want to jump straight to,
 * as opposed to scrubbing the whole reel tick by tick.
 */
function listNamedStates(animData) {
    const states = [];
    const layers = animData?.AN?.TL?.L || [];
    for (const layer of layers) {
        for (const frame of layer.FR || []) {
            if (frame.N) {
                states.push({ name: frame.N, startTick: frame.I || 0, duration: frame.DU || 1 });
            }
        }
    }
    return states;
}

export default {
    multiplyMatrix,
    getTimelineDuration,
    resolveFrame,
    computeDrawList,
    getRootDuration,
    listNamedStates,
    buildSymbolLookup,
    IDENTITY_MATRIX
};
