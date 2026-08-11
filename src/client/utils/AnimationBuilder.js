/**
 * AnimationBuilder - Generate Animation.json from named sprite sequences
 * 
 * Honest Animation.json generator for cases where user has individual frames
 * named with sequential patterns (e.g., idle_0, idle_1, idle_2, walk_0, walk_1...).
 * 
 * Uses cleanPrefix() for consistent grouping (same as Sparrow.js uses for maxSizes).
 * Generated Animation.json is marked as "Washos Packer" origin, not pretending to be
 * from Adobe Animate/BetterTA extension.
 * 
 * This is OPT-IN only - user must explicitly check "Generate Animation.json" option.
 */

// Extension is explicit so this module also loads under plain node for the tests
import { smartSortImages, cleanPrefix } from './common.js';

/**
 * Group frames by prefix using cleanPrefix (same as Sparrow.js)
 * Maintains sort order using smartSortImages
 *
 * Special handling for numeric-only names: cleanPrefix strips ALL trailing
 * digits, so a purely-numeric name like "0" or "042" reduces to "" - every
 * such frame would otherwise collapse into one shared nameless group. Any
 * frame whose name reduces to "" falls back to using its own full name as
 * the prefix instead, so each becomes its own standalone group.
 *
 * This is checked per frame, not once for the whole set: an earlier version
 * only special-cased sets where EVERY name was purely numeric, so a mixed
 * set (bare "0", "1" alongside "idle_0", "idle_1") still let the numeric
 * ones collide into a shared "" group while "idle_0"/"idle_1" correctly
 * grouped under "idle_".
 */
function groupFramesByPrefix(rects) {
    let groups = new Map();

    // Sort frames first to maintain order
    let sortedRects = [...rects].sort((a, b) => {
        return smartSortImages(a.name, b.name);
    });

    for (let rect of sortedRects) {
        let name = rect.name || rect.originalFile || '';
        // Remove extension if present
        name = name.replace(/\.[^.]+$/, '');

        let prefix = cleanPrefix(name);
        if (!prefix) prefix = name;

        if (!groups.has(prefix)) {
            groups.set(prefix, []);
        }
        groups.get(prefix).push({
            name: name,
            rect: rect
        });
    }

    return groups;
}

/**
 * Build a single symbol definition with linear timeline
 */
function buildSymbol(animName, orderedFrames) {
    let layers = [];
    
    // Main sprite layer - one frame per sprite
    let spriteLayer = {
        LN: "Layer_1",
        FR: []
    };
    
    for (let i = 0; i < orderedFrames.length; i++) {
        let frame = orderedFrames[i];
        spriteLayer.FR.push({
            I: i,
            DU: 1,  // Each frame shows for 1 tick
            E: [{
                ASI: {
                    MX: [1, 0, 0, 1, 0, 0],  // Identity matrix - sprite already positioned in atlas
                    N: frame.name
                }
            }]
        });
    }
    
    // Add final hold frame
    if (orderedFrames.length > 0) {
        spriteLayer.FR.push({
            I: orderedFrames.length,
            DU: 1,
            E: []
        });
    }
    
    layers.push(spriteLayer);
    
    return {
        SN: animName,
        TL: {
            L: layers
        }
    };
}

/**
 * Build root timeline referencing all symbols
 */
function buildRootTimeline(symbolNames, fps = 24) {
    let layers = [];
    
    // Symbol sequence layer - transitions between symbols
    let sequenceLayer = {
        LN: "Animation_Sequence",
        FR: []
    };
    
    let frameIndex = 0;
    
    for (let i = 0; i < symbolNames.length; i++) {
        let symName = symbolNames[i];
        sequenceLayer.FR.push({
            N: symName,
            I: frameIndex,
            DU: 1,  // 1 frame transition
            E: [{
                SI: {
                    SN: symName,
                    FF: 0,
                    ST: "G",
                    TRP: { x: 0, y: 0 },
                    LP: "LP",
                    MX: [1, 0, 0, 1, 0, 0]
                }
            }]
        });
        frameIndex++;
    }
    
    layers.push(sequenceLayer);
    
    return {
        N: "animations",
        SN: "__FUNKYPACKER_GENERATED__",
        TL: {
            L: layers
        }
    };
}

/**
 * Build symbol dictionary with all animation symbols
 */
function buildSymbolDictionary(symbolGroups) {
    let symbols = [];
    
    for (let [animName, frames] of symbolGroups) {
        let symbol = buildSymbol(animName, frames);
        symbols.push(symbol);
    }
    
    return {
        S: symbols
    };
}

/**
 * Generate complete Animation.json from frames
 * 
 * @param {Array} rects - Array of frame objects with name property
 * @param {Object} options - Generation options
 * @param {number} options.fps - Frame rate (default: 24)
 * @param {string} options.canvasWidth - Canvas width (default: 1280)
 * @param {string} options.canvasHeight - Canvas height (default: 720)
 * @param {string} options.backgroundColor - Background color (default: #999999)
 * @returns {Object} Complete Animation.json structure
 */
function generateAnimationJson(rects, options = {}) {
    const FPS = options.fps || 24;
    const CANVAS_W = options.canvasWidth || 1280;
    const CANVAS_H = options.canvasHeight || 720;
    const BG_COLOR = options.backgroundColor || "#999999";
    
    // Group frames by prefix using cleanPrefix
    let symbolGroups = groupFramesByPrefix(rects);
    
    // Sort symbol names for consistent output
    let symbolNames = Array.from(symbolGroups.keys()).sort();
    
    // Build structure
    let rootTimeline = buildRootTimeline(symbolNames, FPS);
    let symbolDict = buildSymbolDictionary(symbolGroups);
    
    // Metadata - honest about origin
    let metadata = {
        V: "Washos Packer 1.0",
        N: "animations",
        BGC: BG_COLOR,
        W: CANVAS_W,
        H: CANVAS_H,
        ASV: 3,
        FRT: FPS,
        NOTE: "Generated by Washos Packer - not from Adobe Animate BetterTA extension"
    };
    
    return {
        AN: rootTimeline,
        SD: symbolDict,
        MD: metadata
    };
}

/**
 * Export as JSON string
 */
function generateAnimationJsonString(rects, options = {}) {
    let json = generateAnimationJson(rects, options);
    return JSON.stringify(json, null, 2);
}

/**
 * Get grouped frames info for preview
 */
function getAnimationPreview(rects) {
    let symbolGroups = groupFramesByPrefix(rects);
    let preview = [];
    
    for (let [name, frames] of symbolGroups) {
        preview.push({
            symbolName: name,
            frameCount: frames.length,
            frames: frames.map(f => f.name)
        });
    }
    
    // Sort by name
    preview.sort((a, b) => a.symbolName.localeCompare(b.symbolName));
    
    return preview;
}

// Export functions
export {
    groupFramesByPrefix,
    buildSymbol,
    buildRootTimeline,
    buildSymbolDictionary,
    generateAnimationJson,
    generateAnimationJsonString,
    getAnimationPreview
};

export default {
    groupFramesByPrefix,
    buildSymbol,
    buildRootTimeline,
    buildSymbolDictionary,
    generateAnimationJson,
    generateAnimationJsonString,
    getAnimationPreview
};
