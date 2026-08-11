/**
 * Regression suite for splitters/Spine.js's check().
 *
 * Run with:  node test/spine-splitter.test.mjs
 *
 * check() must call its callback exactly once. The original had no `return`
 * after its early `cb(false)` calls, so a disqualifying condition (non-empty
 * first line, non-empty last line) didn't stop execution - the function fell
 * through and called cb again for every remaining check, with the LAST call
 * (the "size:" line check) always deciding the final outcome regardless of
 * what disqualified it earlier. Masked today because getSplitterByData locks
 * onto whichever splitter answers true first and ignores callbacks from
 * splitters checked after that, and every format ahead of Spine in that list
 * has a correctly single-shot check - but not masked for a file that reaches
 * Spine's check without an earlier match.
 */

import Spine from '../src/client/splitters/Spine.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function check(label, data, expected) {
    runs++;
    let calls = [];
    Spine.check(data, v => calls.push(v));

    if (calls.length !== 1) {
        fail(label, `cb called ${calls.length} times (${JSON.stringify(calls)}), expected exactly once`);
        return;
    }
    // getSplitterByData only ever tests truthiness (`if (checked)`), so undefined
    // and false are equivalent to every caller in this codebase - compare
    // truthiness rather than strict equality. (Very short input can produce
    // `undefined` here rather than `false`, since `lines[2]` is out of range;
    // that's a minor observability quirk, not a functional difference.)
    if (!!calls[0] !== !!expected) {
        fail(label, `got ${calls[0]}, expected ${expected}`);
    }
}

const validAtlas =
    '\nspritesheet.png\nsize: 512,512\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n' +
    'sprite1\n  rotate: false\n  xy: 2, 2\n  size: 100, 100\n  orig: 100, 100\n  offset: 0, 0\n  index: -1\n';

check('valid spine atlas', validAtlas, true);
check('non-empty first line disqualifies', 'not empty\nfoo\nbar\n', false);
check('non-empty last line disqualifies', '\nfoo\nsize: 1,1\nbar', false);
check('empty input', '', false);
check('missing size: line', '\nfoo\nbar\nbaz\n', false);

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
