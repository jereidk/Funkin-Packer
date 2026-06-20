import Splitter from './Splitter';

/**
 * BetterTA Splitter - Parses Adobe Animate Better Texture Atlas format
 * 
 * Supports:
 * - {ATLAS: {SPRITES: [{SPRITE: {...}}, ...]}} format
 * - Multi-page atlas (spritemap1, spritemap2, etc.)
 * 
 * Note: This splitter only reads the spritemap (sprite rectangles).
 * Animation.json (timelines, symbols, layers) is preserved separately
 * and re-exported unchanged during pack operations.
 */
class BetterTA extends Splitter {
    /**
     * Check if data is BetterTA format
     * @param {string|object} data - Raw file content or parsed JSON
     * @param {function} cb - Callback with boolean result
     */
    static check(data, cb) {
        try {
            let json = typeof data === 'string' ? JSON.parse(data) : data;
            
            // BetterTA format: {ATLAS: {SPRITES: [...]}}
            let isBetterTA = json && 
                            json.ATLAS && 
                            json.ATLAS.SPRITES && 
                            Array.isArray(json.ATLAS.SPRITES);
            
            // Also check for spritemap format with meta
            let isSpritemap = json &&
                             json.meta && 
                             json.meta.app && 
                             (json.meta.app.includes('Adobe Animate') || 
                              json.meta.app.includes('Better TA'));
            
            cb(isBetterTA || isSpritemap);
        }
        catch(e) {
            cb(false);
        }
    }

    /**
     * Split BetterTA atlas into frame objects
     * @param {string|object} data - Raw file content or parsed JSON
     * @param {object} options - Packer options
     * @param {function} cb - Callback with array of frames
     */
    static split(data, options, cb) {
        let frames = [];
        
        try {
            let json = typeof data === 'string' ? JSON.parse(data) : data;
            
            // BetterTA format: {ATLAS: {SPRITES: [{SPRITE: {...}}, ...]}}
            if (json && json.ATLAS && json.ATLAS.SPRITES) {
                for (let item of json.ATLAS.SPRITES) {
                    // Handle nested SPRITE object
                    let sprite = item.SPRITE || item;
                    
                    // Skip invalid entries
                    if (!sprite.name && !sprite.n) {
                        console.warn('BetterTA: skipping entry without name:', item);
                        continue;
                    }
                    
                    frames.push({
                        name: String(sprite.name || sprite.n || ''),
                        frame: {
                            x: parseInt(sprite.x) || 0,
                            y: parseInt(sprite.y) || 0,
                            w: parseInt(sprite.w) || 0,
                            h: parseInt(sprite.h) || 0
                        },
                        rotated: sprite.rotated === true || sprite.rotated === 'true',
                        trimmed: false,
                        spriteSourceSize: {
                            x: 0,
                            y: 0,
                            w: parseInt(sprite.w) || 0,
                            h: parseInt(sprite.h) || 0
                        },
                        sourceSize: {
                            w: parseInt(sprite.w) || 0,
                            h: parseInt(sprite.h) || 0
                        },
                        originalFile: String(sprite.name || sprite.n || ''),
                        // Preserve atlas metadata for round-trip
                        atlasMeta: json.meta || {}
                    });
                }
            }
            // Standard format: array of frames
            else if (Array.isArray(json)) {
                for (let item of json) {
                    frames.push({
                        name: String(item.name || item.n || ''),
                        frame: {
                            x: parseInt(item.frame?.x || item.x) || 0,
                            y: parseInt(item.frame?.y || item.y) || 0,
                            w: parseInt(item.frame?.w || item.w) || 0,
                            h: parseInt(item.frame?.h || item.h) || 0
                        },
                        rotated: item.rotated === true,
                        trimmed: item.trimmed === true,
                        spriteSourceSize: {
                            x: parseInt(item.spriteSourceSize?.x || 0),
                            y: parseInt(item.spriteSourceSize?.y || 0),
                            w: parseInt(item.spriteSourceSize?.w || item.frame?.w || item.w) || 0,
                            h: parseInt(item.spriteSourceSize?.h || item.frame?.h || item.h) || 0
                        },
                        sourceSize: {
                            w: parseInt(item.sourceSize?.w || item.frame?.w || item.w) || 0,
                            h: parseInt(item.sourceSize?.h || item.frame?.h || item.h) || 0
                        },
                        originalFile: String(item.name || item.n || '')
                    });
                }
            }
        }
        catch(e) {
            console.error('BetterTA splitter error:', e);
        }
        
        cb(frames);
    }

    static get type() {
        return 'BetterTA';
    }

    static get inverseRotation() {
        return false;
    }
}

export default BetterTA;
