/**
 * Regression test: 'multi-atlas' solver mode must behave differently from
 * 'auto', not compute the same single-sheet size.
 *
 * Run with: node test/multi-atlas-mode.test.mjs
 *
 * Before this fix, PackProcessor.calculateOptimalDimensions() had branches
 * for 'manual', 'scale' and 'auto', but 'multi-atlas' fell through to the
 * same generic path as any unhandled mode - producing the exact same
 * single-sheet-sized result as 'auto' for any content that fit on one sheet.
 * The only thing that ever actually produced multiple sheets was an
 * unrelated fallback deep in AdvancedSmartSizeSolver that only kicks in when
 * content literally cannot fit on one 4096x4096 sheet - so in practice, for
 * normal-sized packs, "Auto" and "Multi-Atlas" were indistinguishable.
 *
 * This exercises AdvancedSmartSizeSolver directly (which PackProcessor's new
 * multi-atlas branch calls with an explicit maxSizeLimit) rather than
 * PackProcessor itself, since PackProcessor.pack() depends on DOM canvas
 * APIs unavailable under plain node.
 */

import AdvancedSmartSizeSolver from '../src/client/utils/AdvancedSmartSizeSolver.js';

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

function makeRects(count, w, h) {
    let rects = [];
    for (let i = 0; i < count; i++) rects.push({ frame: { w, h } });
    return rects;
}

console.log('=== multi-atlas cap is honored and differs from the uncapped auto result ===');
runs++;
{
    const rects = makeRects(500, 150, 150);

    const auto = AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, { algorithm: 'best' });
    const multi = AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, { algorithm: 'best', maxSizeLimit: 2048 });

    if (auto.width <= 2048 && auto.height <= 2048) {
        fail('setup', 'expected the uncapped auto result to exceed 2048 on at least one side for this fixture');
    }
    if (multi.width > 2048 || multi.height > 2048) {
        fail('cap honored', `multi-atlas result ${multi.width}x${multi.height} exceeds the 2048 cap`);
    }
    if (multi.width === auto.width && multi.height === auto.height) {
        fail('modes differ', 'multi-atlas produced the exact same size as auto - the two modes are indistinguishable');
    }
}

console.log('=== an explicit maxSizeLimit smaller than disableMaxLimit\'s 8192 still wins ===');
runs++;
{
    const rects = makeRects(50, 100, 100);
    const result = AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, {
        algorithm: 'best',
        disableMaxLimit: true,
        maxSizeLimit: 1024
    });
    if (result.width > 1024 || result.height > 1024) {
        fail('explicit cap over disableMaxLimit', `got ${result.width}x${result.height}, expected both sides <= 1024`);
    }
}

console.log('=== omitting maxSizeLimit falls back to the normal 4096/8192 behavior ===');
runs++;
{
    const rects = makeRects(10, 100, 100);
    const withoutCap = AdvancedSmartSizeSolver.calculateOptimalDimensions(rects, { algorithm: 'best' });
    if (withoutCap.width > 4096 || withoutCap.height > 4096) {
        fail('default cap', `expected default 4096 cap to still apply, got ${withoutCap.width}x${withoutCap.height}`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
