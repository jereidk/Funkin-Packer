/**
 * Regression test for AnimationLinker.js's reference-counting walk.
 *
 * Run with: node test/animation-linker.test.mjs
 *
 * walkForSpriteReferences() visited every array element twice: once via its
 * dedicated `if (Array.isArray(node))` branch, and again via the generic
 * `for (let key in node)` loop right after it - `for...in` on an array also
 * enumerates its numeric indices as string keys, and nothing stopped that
 * loop from running for arrays too. The duplication compounds at every
 * nested array level below the point it starts, so a single real reference
 * sitting inside N nested arrays got recorded 2^N times instead of once.
 *
 * Found on a real production BetterTA export (Friday Night Funkin''s
 * Boyfriend character, animation.json with the standard Layers -> Frames ->
 * Elements array nesting, 3 levels deep): every one of its 33 symbols
 * showed exactly "8x" usage in AnimationTreeView regardless of how many
 * times it actually appeared - 8 = 2^3, matching the three nested array
 * levels exactly. Manually counting the raw JSON confirmed the true count
 * for one such symbol ("BF idle dance") was 1, not 8.
 *
 * getReferencedSprites()/getReferencedSymbols() were unaffected (they only
 * check whether a name has ANY reference, and duplicates don't change set
 * membership) - only getSymbolReferenceCounts(), the "used Nx" number
 * AnimationTreeView displays per symbol, was wrong.
 */

import AnimationLinker from '../src/client/utils/AnimationLinker.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function buildAnimation(nestingDepth) {
    // Nest a single SI reference `nestingDepth` arrays deep, mirroring
    // Animation.json's real Layers -> Frames -> Elements -> ... shape.
    let node = { SI: { SN: 'MySymbol' } };
    for (let i = 0; i < nestingDepth; i++) {
        node = [node];
    }
    return {
        AN: { N: 'root', TL: { L: node } },
        SD: { S: [{ SN: 'MySymbol' }] }
    };
}

console.log('=== a single reference nested inside 3 arrays counts as exactly 1 ===');
runs++;
{
    const linker = new AnimationLinker();
    linker.loadAnimation(buildAnimation(3));
    const counts = linker.getSymbolReferenceCounts();
    const count = counts.get('MySymbol') || 0;
    if (count !== 1) {
        fail('3-deep nesting', `expected count 1, got ${count} (bug produced 2^3=8)`);
    }
}

console.log('=== deeper nesting (5 arrays) still counts as exactly 1 ===');
runs++;
{
    const linker = new AnimationLinker();
    linker.loadAnimation(buildAnimation(5));
    const count = linker.getSymbolReferenceCounts().get('MySymbol') || 0;
    if (count !== 1) {
        fail('5-deep nesting', `expected count 1, got ${count} (bug would produce 2^5=32)`);
    }
}

console.log('=== N genuinely repeated references at the same nesting depth count as N ===');
runs++;
{
    const frames = [];
    for (let i = 0; i < 4; i++) {
        frames.push({ E: [{ SI: { SN: 'RepeatedSymbol' } }] });
    }
    const animData = {
        AN: { N: 'root', TL: { L: [{ FR: frames }] } },
        SD: { S: [{ SN: 'RepeatedSymbol' }] }
    };
    const linker = new AnimationLinker();
    linker.loadAnimation(animData);
    const count = linker.getSymbolReferenceCounts().get('RepeatedSymbol') || 0;
    if (count !== 4) {
        fail('4 genuine repeats', `expected count 4, got ${count}`);
    }
}

console.log('=== ASI (sprite) references are also counted correctly, not just SI (symbol) ===');
runs++;
{
    const animData = {
        AN: { N: 'root', TL: { L: [{ FR: [{ E: [{ ASI: { N: '7' } }] }] }] } },
        SD: { S: [] }
    };
    const linker = new AnimationLinker();
    linker.loadAnimation(animData);
    const sprites = linker.getReferencedSprites();
    if (!sprites.includes('7')) {
        fail('ASI reference detection', `expected sprite "7" to be referenced, got ${JSON.stringify(sprites)}`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
