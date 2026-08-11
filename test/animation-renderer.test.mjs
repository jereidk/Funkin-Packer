/**
 * Regression/validation test for AnimationRenderer.js against synthetic
 * fixtures and, when available, a real production Animation.json.
 *
 * Run with: node test/animation-renderer.test.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AR from '../src/client/utils/AnimationRenderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function approxMatrix(a, b, eps = 1e-6) {
    return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
}

console.log('=== multiplyMatrix composes translation + scale correctly ===');
runs++;
{
    // Parent: translate by (100, 50). Child: scale by 2 in x, translate by (10, 0).
    const parent = [1, 0, 0, 1, 100, 50];
    const child = [2, 0, 0, 1, 10, 0];
    const result = AR.multiplyMatrix(parent, child);
    // A point at child-local (0,0) should land at parent(child(0,0)) = parent(10,0) = (110, 50)
    const px = result[4], py = result[5];
    if (Math.abs(px - 110) > 1e-6 || Math.abs(py - 50) > 1e-6) {
        fail('translate+scale composition', `expected (110,50), got (${px},${py})`);
    }
}

console.log('=== getTimelineDuration finds the longest layer, minimum 1 ===');
runs++;
{
    const node = { TL: { L: [
        { FR: [{ I: 0, DU: 5 }] },       // ends at 5
        { FR: [{ I: 0, DU: 3 }, { I: 3, DU: 10 }] } // ends at 13
    ] } };
    if (AR.getTimelineDuration(node) !== 13) {
        fail('longest layer', `expected 13, got ${AR.getTimelineDuration(node)}`);
    }
    if (AR.getTimelineDuration({}) !== 1) {
        fail('empty timeline minimum', `expected 1, got ${AR.getTimelineDuration({})}`);
    }
}

console.log('=== computeDrawList resolves a simple ASI leaf with correct matrix ===');
runs++;
{
    const animData = {
        AN: { TL: { L: [{ FR: [{ I: 0, DU: 1, E: [{ ASI: { N: 'sprite0', MX: [1, 0, 0, 1, 5, 7] } }] }] }] } },
        SD: { S: [] }
    };
    const list = AR.computeDrawList(animData, 0);
    if (list.length !== 1) fail('single ASI', `expected 1 draw entry, got ${list.length}`);
    else {
        if (list[0].spriteName !== 'sprite0') fail('single ASI name', `got ${list[0].spriteName}`);
        if (!approxMatrix(list[0].matrix, [1, 0, 0, 1, 5, 7])) fail('single ASI matrix', JSON.stringify(list[0].matrix));
    }
}

console.log('=== computeDrawList composes matrices through a nested SI symbol ===');
runs++;
{
    const animData = {
        AN: { TL: { L: [{ FR: [{ I: 0, DU: 1, E: [{ SI: { SN: 'Arm', FF: 0, MX: [1, 0, 0, 1, 100, 0] } }] }] }] } },
        SD: { S: [
            { SN: 'Arm', TL: { L: [{ FR: [{ I: 0, DU: 1, E: [{ ASI: { N: 'armSprite', MX: [1, 0, 0, 1, 10, 0] } }] }] }] } }
        ] }
    };
    const list = AR.computeDrawList(animData, 0);
    if (list.length !== 1) fail('nested SI count', `expected 1, got ${list.length}`);
    else if (!approxMatrix(list[0].matrix, [1, 0, 0, 1, 110, 0])) {
        fail('nested SI composed matrix', `expected tx=110, got ${JSON.stringify(list[0].matrix)}`);
    }
}

console.log('=== a looping nested symbol advances on its own local playhead ===');
runs++;
{
    // Child symbol has 2 frames, each showing a different sprite. Parent
    // places it for 4 ticks - the child should loop through frame0, frame1,
    // frame0, frame1 as the parent's local offset increases.
    const animData = {
        AN: { TL: { L: [{ FR: [{ I: 0, DU: 4, E: [{ SI: { SN: 'Blink', FF: 0, MX: AR.IDENTITY_MATRIX } }] }] }] } },
        SD: { S: [
            { SN: 'Blink', TL: { L: [{ FR: [
                { I: 0, DU: 1, E: [{ ASI: { N: 'eyesOpen', MX: AR.IDENTITY_MATRIX } }] },
                { I: 1, DU: 1, E: [{ ASI: { N: 'eyesClosed', MX: AR.IDENTITY_MATRIX } }] }
            ] }] } }
        ] }
    };
    const spritesByTick = [0, 1, 2, 3].map(t => AR.computeDrawList(animData, t)[0]?.spriteName);
    const expected = ['eyesOpen', 'eyesClosed', 'eyesOpen', 'eyesClosed'];
    if (JSON.stringify(spritesByTick) !== JSON.stringify(expected)) {
        fail('looping nested symbol', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(spritesByTick)}`);
    }
}

console.log('=== a missing/orphaned SI reference is skipped, not thrown ===');
runs++;
{
    const animData = {
        AN: { TL: { L: [{ FR: [{ I: 0, DU: 1, E: [{ SI: { SN: 'DoesNotExist', MX: AR.IDENTITY_MATRIX } }] }] }] } },
        SD: { S: [] }
    };
    let threw = false;
    let list = [];
    try { list = AR.computeDrawList(animData, 0); } catch (e) { threw = true; }
    if (threw) fail('orphaned SI', 'computeDrawList threw instead of skipping the missing symbol');
    if (list.length !== 0) fail('orphaned SI result', `expected an empty draw list, got ${list.length} entries`);
}

console.log('=== listNamedStates picks up root-timeline frame labels ===');
runs++;
{
    const animData = {
        AN: { TL: { L: [
            { FR: [{ N: 'Idle', I: 0, DU: 10 }, { N: 'Left', I: 10, DU: 5 }] },
            { FR: [{ I: 0, DU: 15, E: [] }] } // content layer, no labels
        ] } }
    };
    const states = AR.listNamedStates(animData);
    if (states.length !== 2 || states[0].name !== 'Idle' || states[1].startTick !== 10) {
        fail('listNamedStates', JSON.stringify(states));
    }
}

// --- Validation against the real production file, if present on disk ---
// (Not committed to the repo - this block is a no-op unless the fixture
// happens to be available locally, e.g. during interactive testing.)
const realFixture = path.join(__dirname, '..', '..', 'boyfriend-fixture', 'Animation.json');
if (fs.existsSync(realFixture)) {
    console.log('=== real BOYFRIEND Animation.json: root duration and draw list are sane ===');
    runs++;
    const animData = JSON.parse(fs.readFileSync(realFixture, 'utf8'));
    const duration = AR.getRootDuration(animData);
    const states = AR.listNamedStates(animData);
    const firstDraw = AR.computeDrawList(animData, 0);
    if (duration <= 0) fail('real file duration', `got ${duration}`);
    if (states.length === 0) fail('real file named states', 'expected at least one named state');
    if (firstDraw.length === 0) fail('real file first-tick draw list', 'expected at least one sprite drawn at tick 0');
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
