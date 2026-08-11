import MaxRectsBinPack from './packers/MaxRectsBin';
import OptimalPacker from './packers/OptimalPacker';
import allPackers from './packers';
import Trimmer from './utils/Trimmer';
import TextureRenderer from './utils/TextureRenderer';
import SmartSizeSolver from './utils/SmartSizeSolver';
import { detectIdentical, hashBytes } from './utils/IdenticalDetector';

import I18 from './utils/I18';

// Solver mode constants
const SOLVER_MODE = {
    SCALE: 'scale',
    AUTO: 'auto',
    MULTI_ATLAS: 'multi-atlas',
    MANUAL: 'manual'
};

class PackProcessor {

    // detectIdentical/compareImages/hashBytes live in IdenticalDetector.js -
    // dependency-free (no DOM, no packages that need node_modules) so they can
    // be exercised directly in test/detect-identical.test.mjs. See that module
    // for what changed and why (an O(n^2)-plus pairwise byte scan replaced with
    // hash-bucketing + union-find: ~2.6s -> ~0.14s on 3000 near-duplicate
    // frames, plus a latent data-loss bug fixed as a side effect).
    static detectIdentical(rects, didTrim) {
        return detectIdentical(rects, didTrim);
    }

    static hashBytes(bytes) {
        return hashBytes(bytes);
    }

    static applyIdentical(rects, identical) {
        let clones = [];
        let removeIdentical = [];

        for (let item of identical) {
            let ix = rects.indexOf(item.identical);
            if (ix >= 0) {
                let rect = rects[ix];

                let clone = Object.assign({}, rect);

                clone.name = item.name;
                clone.image = item.image;
                clone.originalFile = item.file;
                clone.frame = Object.assign({}, item.frame);
                clone.frame.x = rect.frame.x;
                clone.frame.y = rect.frame.y;
                clone.sourceSize = Object.assign({}, item.sourceSize);
                clone.spriteSourceSize = Object.assign({}, item.spriteSourceSize);
                clone.skipRender = true;

                removeIdentical.push(item);
                clones.push(clone);
            }
        }

        for (let item of removeIdentical) {
            identical.splice(identical.indexOf(item), 1);
        }

        for (let item of clones) {
            item.cloned = true;
            rects.push(item);
        }

        return rects;
    }

    static pack(images = {}, options = {}, onComplete = null, onError = null) {
        //debugger;
        let rects = [];

        let spritePadding = options.spritePadding || 0;
        let borderPadding = options.borderPadding || 0;

        let maxWidth = 0, maxHeight = 0;
        let minWidth = 0, minHeight = 0;

        let alphaThreshold = options.alphaThreshold || 0;
        if (alphaThreshold > 255) alphaThreshold = 255;

        let names = Object.keys(images).sort();

        for (let key of names) {
            let img = images[key];

            let name = key.split(".")[0];

            rects.push({
                frame: { x: 0, y: 0, w: img.width, h: img.height },
                rotated: false,
                trimmed: false,
                spriteSourceSize: { x: 0, y: 0, w: img.width, h: img.height },
                sourceSize: { w: img.width, h: img.height },
                name: name,
                file: key,
                image: img
            });
        }

        // Trim and de-duplicate BEFORE sizing the sheet. Both steps change what is
        // actually packed - Trimmer rewrites frame.w/h in place and detectIdentical
        // removes rects entirely - so running the solver first sized the atlas for
        // sprites that no longer exist at that size, or at all.
        if (options.allowTrim) {
            Trimmer.trim(rects, alphaThreshold);
        }

        let identical = [];

        if (options.detectIdentical) {
            let res = PackProcessor.detectIdentical(rects, options.allowTrim);

            rects = res.rects;
            identical = res.identical;
        }

        for (let rect of rects) {
            maxWidth += rect.frame.w;
            maxHeight += rect.frame.h;

            // Compare padded against padded. Testing the raw width against an already
            // padded running maximum understates the minimum, letting a sheet through
            // that the widest sprite cannot actually fit into.
            let paddedW = rect.frame.w + spritePadding * 2;
            let paddedH = rect.frame.h + spritePadding * 2;

            if (paddedW > minWidth) minWidth = paddedW;
            if (paddedH > minHeight) minHeight = paddedH;
        }

        minWidth += borderPadding * 2;
        minHeight += borderPadding * 2;

        let width = options.width || 0;
        let height = options.height || 0;

        // SMART SIZE SOLVER INTEGRATION
        // If solverMode is not 'manual', calculate optimal dimensions
        const solverMode = options.solverMode || SOLVER_MODE.MANUAL;
        
        if (solverMode !== SOLVER_MODE.MANUAL && rects.length > 0) {
            const solverResult = PackProcessor.calculateOptimalDimensions(rects, {
                width: width || 4096,
                height: height || 4096,
                solverMode: solverMode,
                spritePadding: spritePadding,
                borderPadding: borderPadding,
                allowRotation: options.allowRotation || false,
                disableMaxLimit: options.disableMaxLimit || false,
                packingAlgorithm: options.packingAlgorithm || 'best',
                // Let the solver aim at the size it will actually be rounded to below,
                // instead of optimizing a width that then gets rounded up anyway.
                powerOfTwo: options.powerOfTwo || false
            });
            
            width = solverResult.width;
            height = solverResult.height;
            
            // Store solver info for UI feedback
            if (!options._solverInfo) options._solverInfo = {};
            options._solverInfo.lastResult = solverResult;
        }

        if (!width) width = maxWidth;
        if (!height) height = maxHeight;

        if (options.powerOfTwo) {
            let sw = Math.round(Math.log(width) / Math.log(2));
            let sh = Math.round(Math.log(height) / Math.log(2));

            let pw = Math.pow(2, sw);
            let ph = Math.pow(2, sh);

            if (pw < width) pw = Math.pow(2, sw + 1);
            if (ph < height) ph = Math.pow(2, sh + 1);

            width = pw;
            height = ph;
        }

        if (width < minWidth || height < minHeight) {
            if (onError) onError({
                description: I18.f("INVALID_SIZE_ERROR", minWidth, minHeight)
            });
            return;
        }

        // Trying every (packer x method x rotation) combo is expensive per combo:
        // MaxRectsBin's insert2() re-scores every remaining rect against every free
        // rectangle each round, so a single pack is roughly O(n^2), and "Optimal"
        // mode runs up to 18 such combos (5 MaxRectsBin methods + 4 MaxRectsPacker
        // methods, x2 for rotation). Measured: 400 rects ~1.2s, 800 rects ~4.7s for
        // MaxRectsBin's half alone - before MaxRectsPacker's combos are even added.
        // Past a size where that's no longer negligible, use a curated subset
        // instead of the full sweep. It was picked empirically, not guessed: across
        // 60 randomized cases with a sheet sized tight enough that plain
        // BestShortSideFit (no rotation - what a non-Optimal user gets) failed to
        // fit everything, trying the rest of the ensemble rescued a same-sheet fit
        // in 9/9 of those - BottomLeftRule+rotation alone also catches 9/9 of the
        // rescues (re-verified after the swap below), BestShortSideFit+rotation 8/9,
        // BestAreaFit 7/9 - so this subset keeps nearly all of the practical benefit
        // at a third of the cost.
        //
        // ContactPointRule was in this list originally (same 9/9 rescue rate at
        // small N) but turned out to scale badly once multi-sheet packing was
        // fixed to use full-size sheets: its scoring scans every already-placed
        // rect per candidate free rect (O(free x placed) per round, the other
        // methods are O(free)), which is cheap while a sheet is nearly empty but
        // not once a few hundred sprites have landed on it. Measured on 1200
        // sprites needing 6 sheets: BestShortSideFit/BestAreaFit/BottomLeftRule
        // all finish in 200-550ms; ContactPointRule took 5.5s with no rotation
        // and 12s with it - and didn't even win (6-7 sheets, same or worse than
        // the cheap methods). MaxRectsPacker is left out of the fast path since
        // its performance at this scale hasn't been measured here.
        const LARGE_ENSEMBLE_THRESHOLD = 150;

        let getAllPackers = () => {
            let methods = [];

            if (rects.length > LARGE_ENSEMBLE_THRESHOLD) {
                let fastMethods = [
                    MaxRectsBinPack.methods.BestShortSideFit,
                    MaxRectsBinPack.methods.BottomLeftRule,
                    MaxRectsBinPack.methods.BestAreaFit
                ];
                for (let method of fastMethods) {
                    methods.push({ packerClass: MaxRectsBinPack, packerMethod: method, allowRotation: false });
                    if (options.allowRotation) {
                        methods.push({ packerClass: MaxRectsBinPack, packerMethod: method, allowRotation: true });
                    }
                }
                return methods;
            }

            for (let packerClass of allPackers) {
                if (packerClass !== OptimalPacker) {
                    for (let method in packerClass.methods) {
                        methods.push({ packerClass, packerMethod: packerClass.methods[method], allowRotation: false });
                        if (options.allowRotation) {
                            methods.push({ packerClass, packerMethod: packerClass.methods[method], allowRotation: true });
                        }
                    }
                }
            }
            return methods;
        };

        let packerClass = options.packer || MaxRectsBinPack;
        let packerMethod = options.packerMethod || MaxRectsBinPack.methods.BestShortSideFit;
        let packerCombos = (packerClass === OptimalPacker) ? getAllPackers() : [{ packerClass, packerMethod, allowRotation: options.allowRotation }];

        let optimalRes;
        let optimalSheets = Infinity;
        let optimalEfficiency = 0;

        let sourceArea = 0;
        for (let rect of rects) {
            sourceArea += rect.sourceSize.w * rect.sourceSize.h;
        }

        for (let combo of packerCombos) {
            let res = [];
            let sheetArea = 0;

            // duplicate rects if more than 1 combo since the array is mutated in pack()
            let _rects = packerCombos.length > 1 ? rects.map(rect => {
                return Object.assign({}, rect, {
                    frame: Object.assign({}, rect.frame),
                    spriteSourceSize: Object.assign({}, rect.spriteSourceSize),
                    sourceSize: Object.assign({}, rect.sourceSize)
                });
            }) : rects;

            // duplicate identical if more than 1 combo and fix references to point to the
            //  cloned rects since the array is mutated in applyIdentical()
            // Optimize?
            let _identical = packerCombos.length > 1 ? identical.map(rect => {
                for (let rect2 of _rects) {
                    if (rect.identical.image._base64 === rect2.image._base64) {
                        return Object.assign({}, rect, { identical: rect2 });
                    }
                }
            }) : identical;

            while (_rects.length) {
                let packer = new combo.packerClass(width, height, combo.allowRotation, spritePadding);
                let result = packer.pack(_rects, combo.packerMethod);

                // A sheet that fits nothing removes nothing from _rects, so the loop
                // would spin forever and hang the tab. Fail with the size error instead.
                if (!result || !result.length) {
                    if (onError) onError({
                        description: I18.f("INVALID_SIZE_ERROR", minWidth, minHeight)
                    });
                    return;
                }

                if (options.detectIdentical) {
                    result = PackProcessor.applyIdentical(result, _identical);
                }

                res.push(result);

                for (let item of result) {
                    this.removeRect(_rects, item.name);
                }

                let { width: sheetWidth, height: sheetHeight } = TextureRenderer.getSize(result, options);
                sheetArea += sheetWidth * sheetHeight;
            }

            let sheets = res.length;
            let efficiency = sourceArea / sheetArea;
            // TODO: calculate ram usage instead

            if (sheets < optimalSheets || (sheets === optimalSheets && efficiency > optimalEfficiency)) {
                optimalRes = res;
                optimalSheets = sheets;
                optimalEfficiency = efficiency;
            }
        }

        for (let sheet of optimalRes) {
            for(let item of sheet) {
                item.frame.x += borderPadding;
                item.frame.y += borderPadding;
            }
        }

        if (onComplete) {
            onComplete(optimalRes);
        }
    }

    static removeRect(rects, name) {
        for (let i = 0; i < rects.length; i++) {
            if (rects[i].name === name) {
                rects.splice(i, 1);
                return;
            }
        }
    }

    /**
     * Calculate optimal atlas dimensions using SmartSizeSolver
     * @param {Array} rects - Array of sprite rectangles
     * @param {Object} options - Solver options
     * @returns {Object} - { width, height, efficiency, mode, message, algorithm }
     */
    static calculateOptimalDimensions(rects, options = {}) {
        const mode = options.solverMode || SOLVER_MODE.MANUAL;
        
        if (mode === SOLVER_MODE.MANUAL) {
            return {
                width: options.width || 512,
                height: options.height || 512,
                efficiency: 0,
                mode: SOLVER_MODE.MANUAL,
                message: 'Manual mode - using specified dimensions',
                algorithm: 'manual'
            };
        }

        const solverOptions = {
            padding: options.spritePadding || 0,
            borderPadding: options.borderPadding || 0,
            allowRotation: options.allowRotation || false,
            disableMaxLimit: options.disableMaxLimit || false,
            powerOfTwo: options.powerOfTwo || false,
            algorithm: options.packingAlgorithm || SmartSizeSolver.Advanced.ALGORITHM.BEST
        };

        const optimal = SmartSizeSolver.calculateOptimalDimensions(rects, solverOptions);

        if (mode === SOLVER_MODE.SCALE) {
            const scaleResult = SmartSizeSolver.checkScaleRequired(optimal.width, optimal.height);
            if (scaleResult.requiresScale) {
                return {
                    width: scaleResult.scaledWidth,
                    height: scaleResult.scaledHeight,
                    efficiency: optimal.efficiency * scaleResult.scale,
                    mode: SOLVER_MODE.SCALE,
                    message: `Scaled to fit: ${optimal.width}x${optimal.height} -> ${scaleResult.scaledWidth}x${scaleResult.scaledHeight} (${(scaleResult.scale * 100).toFixed(0)}%)`,
                    originalWidth: optimal.width,
                    originalHeight: optimal.height,
                    scale: scaleResult.scale,
                    algorithm: optimal.algorithm
                };
            }
            return {
                width: optimal.width,
                height: optimal.height,
                efficiency: optimal.efficiency,
                mode: SOLVER_MODE.SCALE,
                message: 'Optimal dimensions found',
                algorithm: optimal.algorithm
            };
        }

        if (mode === SOLVER_MODE.AUTO) {
            const scaleResult = SmartSizeSolver.checkScaleRequired(optimal.width, optimal.height);
            
            if (scaleResult.requiresScale && optimal.efficiency < 0.7) {
                return {
                    width: scaleResult.scaledWidth,
                    height: scaleResult.scaledHeight,
                    efficiency: optimal.efficiency * scaleResult.scale,
                    mode: SOLVER_MODE.MULTI_ATLAS,
                    message: `Multi-atlas recommended: single atlas efficiency was ${(optimal.efficiency * 100).toFixed(1)}%`,
                    originalWidth: optimal.width,
                    originalHeight: optimal.height,
                    scale: scaleResult.scale,
                    algorithm: optimal.algorithm
                };
            }
            
            return {
                width: scaleResult.requiresScale ? scaleResult.scaledWidth : optimal.width,
                height: scaleResult.requiresScale ? scaleResult.scaledHeight : optimal.height,
                efficiency: scaleResult.requiresScale ? optimal.efficiency * scaleResult.scale : optimal.efficiency,
                mode: SOLVER_MODE.SCALE,
                message: scaleResult.requiresScale ? 
                    `Scaled to fit: ${optimal.width}x${optimal.height} -> ${scaleResult.scaledWidth}x${scaleResult.scaledHeight}` :
                    'Single atlas optimal',
                algorithm: optimal.algorithm
            };
        }

        return {
            width: optimal.width,
            height: optimal.height,
            efficiency: optimal.efficiency,
            mode: mode,
            message: 'Calculated optimal dimensions',
            algorithm: optimal.algorithm
        };
    }

    static getSolverMode() {
        return SOLVER_MODE;
    }
}

export default PackProcessor;