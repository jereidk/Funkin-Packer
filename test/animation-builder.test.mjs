/**
 * Regression suite for AnimationBuilder.groupFramesByPrefix.
 *
 * Run with:  node test/animation-builder.test.mjs
 *
 * Guards against a grouping bug: cleanPrefix() strips ALL trailing digits, so
 * a purely-numeric frame name like "0" or "042" reduces to "". Every such
 * frame should become its own standalone group (falling back to its full
 * name), not collapse into one shared nameless group with every other
 * numeric-named frame. An earlier version only handled this when EVERY frame
 * in the set was purely numeric; a set mixing bare numeric names with
 * prefixed ones ("0", "1" alongside "idle_0", "idle_1") still let the
 * numeric ones collide.
 */

import { groupFramesByPrefix } from '../src/client/utils/AnimationBuilder.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function frames(names) {
    return names.map(n => ({ name: n }));
}

function groupNames(groups) {
    return [...groups.keys()].sort();
}

console.log('=== all-numeric names stay as separate per-frame groups ===');
runs++;
{
    const groups = groupFramesByPrefix(frames(['0', '1', '2', '10', '11']));
    const expected = ['0', '1', '10', '11', '2'];
    const got = groupNames(groups);
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
        fail('all-numeric', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
    for (const [key, members] of groups) {
        if (members.length !== 1) fail('all-numeric group size', `"${key}" has ${members.length} members, expected 1`);
    }
}

console.log('=== mixed numeric + prefixed names do not collide ===');
runs++;
{
    const groups = groupFramesByPrefix(frames(['0', '1', 'idle_0', 'idle_1', 'idle_2']));

    if (!groups.has('0') || groups.get('0').length !== 1) {
        fail('mixed: "0" group', `expected a standalone group for "0", got ${JSON.stringify(groups.get('0'))}`);
    }
    if (!groups.has('1') || groups.get('1').length !== 1) {
        fail('mixed: "1" group', `expected a standalone group for "1", got ${JSON.stringify(groups.get('1'))}`);
    }
    if (groups.has('')) {
        fail('mixed: empty group', `"0" and "1" collapsed into a shared "" group: ${JSON.stringify(groups.get(''))}`);
    }
    const idle = groups.get('idle_');
    if (!idle || idle.length !== 3) {
        fail('mixed: idle_ group', `expected 3 members in "idle_", got ${JSON.stringify(idle)}`);
    }
}

console.log('=== normal prefixed names group as before ===');
runs++;
{
    const groups = groupFramesByPrefix(frames(['walk_0', 'walk_1', 'walk_2', 'run_0', 'run_1']));
    const walk = groups.get('walk_');
    const run = groups.get('run_');
    if (!walk || walk.length !== 3) fail('prefixed: walk_', `expected 3 members, got ${JSON.stringify(walk)}`);
    if (!run || run.length !== 2) fail('prefixed: run_', `expected 2 members, got ${JSON.stringify(run)}`);
    if (groups.size !== 2) fail('prefixed: group count', `expected exactly 2 groups, got ${groups.size}`);
}

console.log('=== edge cases ===');
runs++;
{
    const groups = groupFramesByPrefix([]);
    if (groups.size !== 0) fail('empty input', `expected no groups, got ${groups.size}`);
}
runs++;
{
    // zero-padded numeric names still reduce to "" and must not collide either
    const groups = groupFramesByPrefix(frames(['000', '001', '002']));
    if (groups.size !== 3) fail('zero-padded numeric', `expected 3 separate groups, got ${groups.size}: ${groupNames(groups)}`);
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
