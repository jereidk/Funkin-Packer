/**
 * Regression test: BasisEncoder must actually be able to extract the
 * factory function out of basis_encoder.js's glue code.
 *
 * Run with: node test/basis-encoder-load.test.mjs
 *
 * Emscripten's UMD-style output ends with:
 *   if (typeof exports === "object" && typeof module === "object") {
 *       module.exports = BASIS; ...
 *   } else if (typeof define === "function" && define["amd"]) {
 *       define([], () => BASIS);
 *   }
 * with no plain `else` for the browser-global case. In a browser (neither
 * CommonJS nor AMD), neither branch runs, so the script's last evaluated
 * statement - and therefore `eval(jsCode)`'s result - is `undefined`, not
 * the BASIS factory. That made every ASTC export silently fail to
 * initialize and fall back to the crude reference JS encoder, regardless
 * of browser or WASM support - the "real" encoder never actually loaded.
 *
 * `new Function(jsCode + '\nreturn BASIS;')()` sidesteps this by running
 * the glue code as a fresh, non-strict function body and explicitly
 * returning the `var BASIS` it declares.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsCode = fs.readFileSync(
    path.join(__dirname, '../src/client/utils/astc/basis_encoder.js'),
    'utf8'
);

let runs = 0, failures = 0;

function fail(label, msg) {
    failures++;
    console.log(`FAIL ${label}: ${msg}`);
}

console.log('=== plain eval() of the glue code does NOT yield the factory (documents the bug) ===');
runs++;
{
    const oldResult = eval(jsCode);
    if (oldResult !== undefined) {
        fail('eval baseline', `expected eval(jsCode) to be undefined (that's the bug being fixed), got ${typeof oldResult}`);
    }
}

console.log('=== new Function(...) extraction yields a callable factory ===');
runs++;
{
    const basisFactory = new Function(jsCode + '\nreturn BASIS;')();
    if (typeof basisFactory !== 'function') {
        fail('factory extraction', `expected a function, got ${typeof basisFactory}`);
    }
}

console.log(`\n${runs - failures}/${runs} checks passed`);
process.exit(failures ? 1 : 0);
